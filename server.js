import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';
import EventEmitter from 'events';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 5000;
const telemetryEmitter = new EventEmitter();

// --- Initialize SQLite Database ---
const db = new Database('cloudgrip.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    client_key TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    budget_usd REAL NOT NULL,
    current_spend_usd REAL NOT NULL,
    trial_expires_at TEXT NOT NULL
  )
`);

// Insert default demo key if it doesn't exist yet
const existingDemo = db.prepare('SELECT * FROM clients WHERE client_key = ?').get('cg-demo-key-12345');
if (!existingDemo) {
  const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO clients (client_key, id, budget_usd, current_spend_usd, trial_expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('cg-demo-key-12345', 'client-demo', 0.05, 0.0, oneWeekFromNow);
  console.log('[CloudGrip DB] Initialized default demo key with 7-day trial.');
}

// --- Express Middleware Setup ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Public Registration Endpoint ---
app.post('/register', (req, res) => {
  const { name } = req.body || {};
  const clientId = name || `user_${crypto.randomBytes(3).toString('hex')}`;
  const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
  const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const trialBudgetUSD = 0.50; // Free trial budget cap

  try {
    db.prepare(`
      INSERT INTO clients (client_key, id, budget_usd, current_spend_usd, trial_expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(clientKey, clientId, trialBudgetUSD, 0.0, oneWeekFromNow);

    console.log(`[CloudGrip Registration] Created new trial key for: ${clientId}`);

    res.json({
      success: true,
      message: '7-day free trial activated!',
      apiKey: clientKey,
      trialBudgetUSD,
      expiresAt: oneWeekFromNow,
      usageHeader: 'x-cloudgrip-key'
    });
  } catch (err) {
    console.error('[Registration Error]', err.message);
    res.status(500).json({ error: 'Failed to generate trial key' });
  }
});

// --- Authentication Middleware (Database-backed) ---
app.use((req, res, next) => {
  if (req.path === '/events' || req.path === '/register') return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;

  if (!clientKey) {
    return res.status(401).json({ error: 'Unauthorized: Missing x-cloudgrip-key header' });
  }

  const clientConfig = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  
  if (!clientConfig) {
    console.warn(`[CloudGrip Auth] Rejected unknown key: ${clientKey}`);
    return res.status(403).json({ error: 'Forbidden: Invalid X-CloudGrip-Key' });
  }

  // Check trial expiration
  if (new Date() > new Date(clientConfig.trial_expires_at)) {
    return res.status(403).json({ error: 'Trial Expired', message: 'Your 7-day free trial has expired. Please upgrade.' });
  }

  req.clientConfig = {
    id: clientConfig.id,
    key: clientConfig.client_key,
    budgetUSD: clientConfig.budget_usd,
    currentSpendUSD: clientConfig.current_spend_usd
  };
  next();
});

// --- Budget Guard Middleware ---
const checkBudget = (req, res, next) => {
  if (req.path === '/events' || req.path === '/register') return next();
  const { budgetUSD, currentSpendUSD } = req.clientConfig;

  if (currentSpendUSD >= budgetUSD) {
    return res.status(429).json({ 
      error: 'Quota Exceeded', 
      message: `Spend limit of $${budgetUSD.toFixed(2)} reached.` 
    });
  }
  next();
};

app.use(checkBudget);

// --- Transparent Proxy Handler with Persistent DB Spend Tracking ---
app.all(/.*/, async (req, res) => {
  if (req.path === '/events') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const onTelemetry = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    telemetryEmitter.on('request', onTelemetry);
    req.on('close', () => telemetryEmitter.removeListener('request', onTelemetry));
    return;
  }

  try {
    const targetUrl = `https://generativelanguage.googleapis.com${req.originalUrl}`;

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (!['host', 'content-length', 'x-cloudgrip-key', 'x-max-budget', 'connection'].includes(lowerKey)) {
        headers[key] = value;
      }
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      headers['x-goog-api-key'] = geminiKey;
      delete headers['authorization'];
    }

    const bodyData = ['POST', 'PUT', 'PATCH'].includes(req.method)
      ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}))
      : undefined;

    if (bodyData && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: bodyData,
    });

    if (response.ok) {
      const newSpend = req.clientConfig.currentSpendUSD + 0.01;
      db.prepare('UPDATE clients SET current_spend_usd = ? WHERE client_key = ?').run(newSpend, req.clientConfig.key);
      req.clientConfig.currentSpendUSD = newSpend;
      console.log(`[CloudGrip Budget] Client ${req.clientConfig.id} persistent spend: $${newSpend.toFixed(2)}`);
    }

    telemetryEmitter.emit('request', {
      timestamp: new Date().toISOString(),
      clientId: req.clientConfig.id,
      path: req.originalUrl,
      targetUrl,
      method: req.method,
      status: response.status,
      currentSpendUSD: req.clientConfig.currentSpendUSD
    });

    res.status(response.status);

    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(lowerKey)) {
        res.setHeader(key, value);
      }
    });

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[Proxy Error]', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy Gateway Error', details: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`[CloudGrip Engine] Listening on port ${PORT} with registration & SQLite persistence active`);
});