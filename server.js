import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';
import EventEmitter from 'events';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const telemetryEmitter = new EventEmitter();

// Ensure persistent storage directory (Render, Railway, Fly.io volume mount points)
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    // fallback
  }
}
const dbPath = path.join(dataDir, 'cloudgrip.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency and robust file-locking resilience across deploys
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    client_key TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    device_fingerprint TEXT,
    budget_usd REAL NOT NULL,
    current_spend_usd REAL NOT NULL,
    trial_expires_at TEXT NOT NULL,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_key TEXT,
    method TEXT,
    endpoint TEXT,
    status_code INTEGER,
    cost REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Terms - CloudGrip AI</title><style>body{font-family:Inter,sans-serif;background:#090a0f;color:#f3f4f6;padding:60px 24px;max-width:700px;margin:auto;line-height:1.6}h1{font-size:24px;color:#fff;margin-bottom:16px}p{font-size:14px;color:#9ca3af}</style></head><body><h1>Terms of Service</h1><p>Welcome to CloudGrip AI. You agree to utilize this gateway infrastructure lawfully and securely.</p></body></html>`);
});

app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy - CloudGrip AI</title><style>body{font-family:Inter,sans-serif;background:#090a0f;color:#f3f4f6;padding:60px 24px;max-width:700px;margin:auto;line-height:1.6}h1{font-size:24px;color:#fff;margin-bottom:16px}p{font-size:14px;color:#9ca3af}</style></head><body><h1>Privacy Policy</h1><p>We protect your credential integrity and process telemetry traffic with maximum security protocols.</p></body></html>`);
});

app.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (!user) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }
  
  res.json({
    success: true,
    message: 'Your account credentials and secure API key recovery instructions have been sent to your email.'
  });
});

app.get('/client/stats', (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized' });

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).json({ error: 'Forbidden' });

  const now = new Date();
  const trialExpiry = new Date(client.trial_expires_at);
  let status = client.status;

  if (now > trialExpiry && client.current_spend_usd <= 0) {
    status = 'expired';
    db.prepare("UPDATE clients SET status = 'expired' WHERE client_key = ?").run(clientKey);
  }

  const logs = db.prepare('SELECT * FROM request_logs WHERE client_key = ? ORDER BY id DESC LIMIT 10').all(clientKey);

  res.json({
    success: true,
    currentSpendUSD: client.current_spend_usd,
    budgetUSD: client.budget_usd,
    trialExpiresAt: client.trial_expires_at,
    status: status,
    logs: logs
  });
});

app.post('/api/topup/initialize', async (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'];
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized' });

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).json({ error: 'Forbidden' });

  const { amount } = req.body || {};
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid payment amount.' });
  }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecret) {
    return res.status(500).json({ error: 'Paystack secret key is not configured on the server environment variables.' });
  }

  try {
    const callbackUrl = `${process.env.BASE_URL || 'https://cloudgrip-ai.onrender.com'}/api/topup/verify?client_key=${clientKey}&amount=${amount}`;
    
    const paystackResponse = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: client.email,
      amount: Math.round(amount * 100),
      callback_url: callbackUrl
    }, {
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      }
    });

    if (paystackResponse.data && paystackResponse.data.status) {
      res.json({
        status: true,
        authorization_url: paystackResponse.data.data.authorization_url
      });
    } else {
      res.status(400).json({ error: 'Could not initialize Paystack transaction.' });
    }
  } catch (err) {
    console.error('Paystack Initialization Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment gateway connection failed.' });
  }
});

app.get('/api/topup/verify', async (req, res) => {
  const { reference, client_key, amount } = req.query;
  if (!reference || !client_key) {
    return res.redirect('/?payment=failed');
  }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  try {
    const verifyResponse = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${paystackSecret}`
      }
    });

    const txData = verifyResponse.data;
    if (txData && txData.status && txData.data.status === 'success') {
      const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(client_key);
      if (client) {
        const addedValueUSD = parseFloat(amount) || 10;
        const newSpend = client.current_spend_usd + addedValueUSD;
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        db.prepare('UPDATE clients SET current_spend_usd = ?, budget_usd = ?, trial_expires_at = ?, status = ? WHERE client_key = ?')
          .run(newSpend, addedValueUSD, newExpiry, 'active', client_key);
      }
      return res.redirect('/?payment=success');
    } else {
      return res.redirect('/?payment=failed');
    }
  } catch (err) {
    console.error('Paystack Verification Error:', err.response?.data || err.message);
    return res.redirect('/?payment=failed');
  }
});

app.get('/events', (req, res) => {
  const clientKey = req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).end();

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const onTelemetry = (data) => {
    if (data.clientKey === clientKey) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  telemetryEmitter.on('telemetry', onTelemetry);

  req.on('close', () => {
    telemetryEmitter.off('telemetry', onTelemetry);
  });
});

app.post('/register', async (req, res) => {
  const { email, password, budget, fingerprint } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const existingUser = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (existingUser) return res.status(400).json({ error: 'Email already registered. Please sign in.' });

  if (fingerprint) {
    const existingDeviceUser = db.prepare('SELECT * FROM clients WHERE device_fingerprint = ?').get(fingerprint);
    if (existingDeviceUser) {
      return res.status(400).json({ 
        error: 'Device limit reached. A free trial has already been claimed from this device.',
        requiresPayment: true 
      });
    }
  }

  const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const status = 'active';
  const initialCredit = 0.00;

  try {
    db.prepare(`
      INSERT INTO clients (client_key, id, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, trial_expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientKey, email.split('@')[0], email, hashedPassword, fingerprint || 'unknown', budget || 10.00, initialCredit, trialExpiresAt, status);

    res.json({ success: true, apiKey: clientKey });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  res.json({ success: true, apiKey: user.client_key });
});

app.use((req, res, next) => {
  if (['/events', '/register', '/login', '/', '/terms', '/privacy', '/client/stats', '/forgot-password'].includes(req.path) || req.path.startsWith('/api/topup/')) return next();
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/')) return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized: Missing key' });

  const clientConfig = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!clientConfig) return res.status(403).json({ error: 'Forbidden: Invalid API Key' });

  const now = new Date();
  const trialExpiry = new Date(clientConfig.trial_expires_at);
  if (now > trialExpiry && clientConfig.current_spend_usd <= 0) {
    db.prepare("UPDATE clients SET status = 'expired' WHERE client_key = ?").run(clientKey);
    return res.status(402).json({ error: 'Payment Required: Your 7-day free trial has expired. Please submit a subscription payment to reactivate your API key.' });
  }

  req.clientConfig = clientConfig;
  next();
});

app.all(/.*/, async (req, res) => {
  if (['/', '/register', '/login', '/events', '/terms', '/privacy', '/client/stats', '/forgot-password'].includes(req.path) || req.path.startsWith('/api/topup/')) return;

  let statusCode = 502;
  let cost = 0.01;

  try {
    const targetUrl = `https://generativelanguage.googleapis.com${req.originalUrl}`;
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!['host', 'content-length', 'x-cloudgrip-key', 'connection'].includes(key.toLowerCase())) {
        headers[key] = value;
      }
    }

    if (process.env.GEMINI_API_KEY) {
      headers['x-goog-api-key'] = process.env.GEMINI_API_KEY;
      delete headers['authorization'];
    }

    const bodyData = ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body || {}) : undefined;
    if (bodyData && !headers['content-type']) headers['content-type'] = 'application/json';

    const response = await fetch(targetUrl, { method: req.method, headers, body: bodyData });
    statusCode = response.status;

    let newSpend = req.clientConfig.current_spend_usd;
    if (response.ok) {
      newSpend = Math.max(0, req.clientConfig.current_spend_usd - cost);
      db.prepare('UPDATE clients SET current_spend_usd = ? WHERE client_key = ?').run(newSpend, req.clientConfig.client_key);
    }

    db.prepare('INSERT INTO request_logs (client_key, method, endpoint, status_code, cost) VALUES (?, ?, ?, ?, ?)').run(
      req.clientConfig.client_key, req.method, req.originalUrl, statusCode, cost
    );

    const logs = db.prepare('SELECT * FROM request_logs WHERE client_key = ? ORDER BY id DESC LIMIT 10').all(req.clientConfig.client_key);

    telemetryEmitter.emit('telemetry', {
      clientKey: req.clientConfig.client_key,
      type: 'telemetry',
      currentSpendUSD: newSpend,
      log: {
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        method: req.method,
        endpoint: req.originalUrl,
        status_code: statusCode,
        cost: cost
      },
      logs: logs
    });

    res.status(statusCode);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    db.prepare('INSERT INTO request_logs (client_key, method, endpoint, status_code, cost) VALUES (?, ?, ?, ?, ?)').run(
      req.clientConfig?.client_key || 'unknown', req.method, req.originalUrl, 502, 0.00
    );
    res.status(502).json({ error: 'Proxy Gateway Error', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[CloudGrip Engine] Live on port ${PORT}`);
});