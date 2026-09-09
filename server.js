import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Track state in memory
let totalSpentUSD = 0.00;
const HARD_BUDGET_LIMIT = 0.50; // $0.50 testing limit
let sseClients = [];

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Broadcast updates to all connected frontend dashboards via SSE
const broadcastTelemetry = (eventData) => {
  sseClients.forEach((client) => {
    client.res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  });
};

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    current_spend: `$${totalSpentUSD.toFixed(4)}`,
    limit: `$${HARD_BUDGET_LIMIT.toFixed(2)}`
  });
});

// Real-time SSE Telemetry Endpoint
app.get('/api/telemetry', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  res.write(`data: ${JSON.stringify({
    type: 'INIT',
    current_spend: totalSpentUSD,
    limit: HARD_BUDGET_LIMIT
  })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter((client) => client.id !== clientId);
  });
});

// Budget Killswitch Middleware
const checkBudgetGuard = (req, res, next) => {
  if (totalSpentUSD >= HARD_BUDGET_LIMIT) {
    const errorMsg = `Hard spend limit of $${HARD_BUDGET_LIMIT.toFixed(2)} reached. Request blocked.`;
    
    broadcastTelemetry({
      type: 'KILLSWITCH_TRIGGERED',
      current_spend: totalSpentUSD,
      limit: HARD_BUDGET_LIMIT,
      message: errorMsg,
      timestamp: new Date().toISOString()
    });

    console.log(`[KILLSWITCH TRIGGERED] Spend limit breached: $${totalSpentUSD.toFixed(2)}`);
    return res.status(429).json({
      error: 'CloudGrip Killswitch Activated',
      message: errorMsg
    });
  }

  totalSpentUSD += 0.10;

  broadcastTelemetry({
    type: 'REQUEST_ALLOWED',
    current_spend: totalSpentUSD,
    limit: HARD_BUDGET_LIMIT,
    timestamp: new Date().toISOString()
  });

  console.log(`[PROXY REQUEST] Allowed. New spend total: $${totalSpentUSD.toFixed(2)}`);
  next();
};

// Proxy endpoints to Google Gemini API
app.use('/v1beta', checkBudgetGuard, createProxyMiddleware({
  target: 'https://generativelanguage.googleapis.com',
  changeOrigin: true,
  pathRewrite: {
    '^/v1beta': '/v1beta'
  }
}));

app.listen(PORT, () => {
  console.log(`CloudGrip Proxy running on http://localhost:${PORT}`);
});