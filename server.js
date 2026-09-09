import dotenv from 'dotenv';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { Redis } from '@upstash/redis';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Upstash Redis if env vars exist, otherwise fallback to in-memory store
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('[CloudGrip] Connected to Upstash Redis for persistent tracking.');
} else {
  console.log('[CloudGrip] No Redis credentials found. Running in in-memory fallback mode.');
}

// In-Memory Fallback State
let localState = {
  totalSpend: 0.00,
  requestCount: 0,
  interceptedCount: 0,
  isCircuitBreakerActive: false,
};

let clients = [];

// Helper to update & stream state
async function updateAndBroadcastState(spendDelta = 0, isBlocked = false) {
  if (redis) {
    try {
      if (spendDelta > 0) {
        localState.totalSpend = await redis.incrbyfloat('cloudgrip:total_spend', spendDelta);
      } else {
        localState.totalSpend = parseFloat((await redis.get('cloudgrip:total_spend')) || 0);
      }
      localState.requestCount = await redis.incr('cloudgrip:request_count');
      if (isBlocked) {
        localState.interceptedCount = await redis.incr('cloudgrip:intercepted_count');
      } else {
        localState.interceptedCount = parseInt((await redis.get('cloudgrip:intercepted_count')) || 0, 10);
      }
    } catch (err) {
      console.error('[Redis Error] Falling back to memory:', err.message);
    }
  } else {
    localState.totalSpend += spendDelta;
    localState.requestCount += 1;
    if (isBlocked) localState.interceptedCount += 1;
  }

  const payload = {
    ...localState,
    totalSpend: parseFloat(localState.totalSpend.toFixed(2)),
    timestamp: new Date().toISOString()
  };

  clients.forEach(client => client.res.write(`data: ${JSON.stringify(payload)}\n\n`));
  return payload;
}

app.use(express.static(__dirname));

// SSE Telemetry Stream
app.get('/api/telemetry/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  clients.push({ id: clientId, res });

  // Send initial state on connection
  updateAndBroadcastState(0, false);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

// Admin endpoint to reset budget counter
app.post('/api/budget/reset', async (req, res) => {
  localState = {
    totalSpend: 0.00,
    requestCount: 0,
    interceptedCount: 0,
    isCircuitBreakerActive: false,
  };

  if (redis) {
    await redis.set('cloudgrip:total_spend', 0);
    await redis.set('cloudgrip:request_count', 0);
    await redis.set('cloudgrip:intercepted_count', 0);
  }

  await updateAndBroadcastState(0, false);
  res.json({ success: true, message: 'Budget state reset successfully.' });
});

// Budget Guard Middleware
const budgetGuard = async (req, res, next) => {
  // Support dynamic custom budget caps via 'x-max-budget' header
  const customCap = req.headers['x-max-budget'] ? parseFloat(req.headers['x-max-budget']) : 0.50;
  const currentSpend = redis ? parseFloat((await redis.get('cloudgrip:total_spend')) || 0) : localState.totalSpend;

  if (currentSpend >= customCap) {
    localState.isCircuitBreakerActive = true;
    await updateAndBroadcastState(0, true);

    return res.status(429).json({
      error: 'Circuit Breaker Triggered',
      message: `Hard spend limit of $${customCap.toFixed(2)} reached. Request blocked by CloudGrip AI.`,
      status: 429
    });
  }

  const estimatedCost = 0.10;
  await updateAndBroadcastState(estimatedCost, false);
  next();
};

// Target Reverse Proxy
app.use('/v1beta', budgetGuard, createProxyMiddleware({
  target: 'https://generativelanguage.googleapis.com',
  changeOrigin: true,
  pathRewrite: { '^/v1beta': '/v1beta' },
  onError: (err, req, res) => {
    res.status(500).json({ error: 'Proxy Gateway Error', details: err.message });
  }
}));

app.listen(PORT, () => {
  console.log(`[CloudGrip Engine] Listening on port ${PORT}`);
});