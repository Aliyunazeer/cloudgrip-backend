import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';
import EventEmitter from 'events';
import pkg from 'pg';
const { Pool } = pkg;
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

// Connect to Supabase PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize PostgreSQL Tables (Drops old mismatched tables and creates clean schema)
async function initDB() {
  await pool.query(`
    DROP TABLE IF EXISTS request_logs;
    DROP TABLE IF EXISTS clients;

    CREATE TABLE clients (
      id SERIAL PRIMARY KEY,
      client_key TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      device_fingerprint TEXT,
      budget_usd REAL NOT NULL,
      current_spend_usd REAL NOT NULL,
      trial_expires_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE request_logs (
      id SERIAL PRIMARY KEY,
      client_key TEXT,
      method TEXT,
      endpoint TEXT,
      status_code INT,
      cost REAL,
      timestamp TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[CloudGrip Engine] Connected to Supabase PostgreSQL & Fresh Tables Created');
}
initDB().catch(console.error);

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

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const user = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
  if (user.rows.length === 0) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }
  res.json({ success: true, message: 'Password recovery instructions sent to your email.' });
});

// Client Stats & Expiry / Key Revocation Check
app.get('/client/stats', async (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized' });

  const result = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
  if (result.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

  const client = result.rows[0];
  const now = new Date();
  const trialExpiry = new Date(client.trial_expires_at);
  let status = client.status;

  // If expired, wipe/revoke the API key so they are forced to subscribe
  if (now > trialExpiry && client.current_spend_usd <= 0) {
    status = 'expired';
    await pool.query("UPDATE clients SET status = 'expired', client_key = NULL WHERE client_key = $1", [clientKey]);
    return res.status(402).json({ error: 'Subscription expired. API key revoked. Please renew subscription.', status: 'expired' });
  }

  const logsResult = await pool.query('SELECT * FROM request_logs WHERE client_key = $1 ORDER BY id DESC LIMIT 10', [clientKey]);

  res.json({
    success: true,
    currentSpendUSD: client.current_spend_usd,
    budgetUSD: client.budget_usd,
    trialExpiresAt: client.trial_expires_at,
    status: status,
    logs: logsResult.rows
  });
});

// Initialize Paystack Subscription ($20 USD converted to NGN)
app.post('/api/topup/initialize', async (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'] || req.body.client_key;
  const email = req.body.email; // Fallback if key was wiped due to expiration

  let client;
  if (clientKey) {
    const resClient = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
    client = resClient.rows[0];
  } else if (email) {
    const resClient = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
    client = resClient.rows[0];
  }

  if (!client) return res.status(403).json({ error: 'Forbidden or Account not found.' });

  const amountUSD = 20.00;
  const usdToNgnRate = parseFloat(process.env.USD_NGN_RATE) || 1500;
  const amountNGN = amountUSD * usdToNgnRate;

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (!paystackSecret) {
    return res.status(500).json({ error: 'Paystack secret key is not configured.' });
  }

  try {
    const cleanBaseUrl = (process.env.BASE_URL || 'https://cloudgrip-ai.onrender.com').replace(/\/+$/, '');
    const callbackUrl = `${cleanBaseUrl}/api/topup/verify?email=${encodeURIComponent(client.email)}&amount=${amountUSD}`;

    const paystackResponse = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: client.email,
      amount: Math.round(amountNGN * 100),
      currency: 'NGN',
      callback_url: callbackUrl
    }, {
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      }
    });

    if (paystackResponse.data && paystackResponse.data.status) {
      res.json({ status: true, authorization_url: paystackResponse.data.data.authorization_url });
    } else {
      res.status(400).json({ error: 'Could not initialize Paystack transaction.' });
    }
  } catch (err) {
    console.error('Paystack Initialization Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment gateway connection failed.' });
  }
});

// Verify Payment & Generate FRESH New API Key
app.get('/api/topup/verify', async (req, res) => {
  const { reference, email, amount } = req.query;
  if (!reference || !email) {
    return res.redirect('/?payment=failed');
  }

  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  try {
    const verifyResponse = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` }
    });

    const txData = verifyResponse.data;
    if (txData && txData.status && txData.data.status === 'success') {
      const clientRes = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
      if (clientRes.rows.length > 0) {
        // Generate a FRESH new API key upon successful payment
        const newClientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
        const addedValueUSD = parseFloat(amount) || 20.00;
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await pool.query(
          'UPDATE clients SET client_key = $1, current_spend_usd = $2, budget_usd = $3, trial_expires_at = $4, status = $5 WHERE email = $6',
          [newClientKey, addedValueUSD, addedValueUSD, newExpiry, 'active', email]
        );

        return res.redirect(`/?payment=success&new_key=${newClientKey}`);
      }
    }
    return res.redirect('/?payment=failed');
  } catch (err) {
    console.error('Paystack Verification Error:', err.message);
    return res.redirect('/?payment=failed');
  }
});

app.get('/events', async (req, res) => {
  const clientKey = req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).end();

  const clientRes = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
  if (clientRes.rows.length === 0) return res.status(403).end();

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
  req.on('close', () => telemetryEmitter.off('telemetry', onTelemetry));
});

// Registration: New devices get free trial key; same-device users register without key until they pay
app.post('/register', async (req, res) => {
  const { email, password, fingerprint } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const existingUser = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) return res.status(400).json({ error: 'Email already registered. Please sign in.' });

  let isNewDevice = true;
  if (fingerprint) {
    const deviceCheck = await pool.query('SELECT * FROM clients WHERE device_fingerprint = $1', [fingerprint]);
    if (deviceCheck.rows.length > 0) {
      isNewDevice = false;
    }
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  let clientKey = null;
  let trialExpiresAt;
  let status = 'pending_payment';

  if (isNewDevice) {
    clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
    trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    status = 'active';
  } else {
    trialExpiresAt = new Date().toISOString();
  }

  try {
    await pool.query(`
      INSERT INTO clients (client_key, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, trial_expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [clientKey, email, hashedPassword, fingerprint || 'unknown', 20.00, 0.00, trialExpiresAt, status]);

    res.json({ 
      success: true, 
      apiKey: clientKey, 
      requiresPayment: !isNewDevice,
      message: isNewDevice ? '7-day trial activated!' : 'Account created. Please complete subscription payment to generate your API key.'
    });
  } catch (err) {
    console.error('Registration Error:', err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const userRes = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);

  if (userRes.rows.length === 0 || !(await bcrypt.compare(password, userRes.rows[0].password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  res.json({ success: true, apiKey: userRes.rows[0].client_key });
});

app.use(async (req, res, next) => {
  if (['/events', '/register', '/login', '/', '/terms', '/privacy', '/client/stats', '/forgot-password'].includes(req.path) || req.path.startsWith('/api/topup/')) return next();
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/')) return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized: Missing key' });

  const clientRes = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
  if (clientRes.rows.length === 0) return res.status(403).json({ error: 'Forbidden: Invalid or Revoked API Key' });

  const clientConfig = clientRes.rows[0];
  const now = new Date();
  const trialExpiry = new Date(clientConfig.trial_expires_at);

  if (now > trialExpiry && clientConfig.current_spend_usd <= 0) {
    await pool.query("UPDATE clients SET status = 'expired', client_key = NULL WHERE client_key = $1", [clientKey]);
    return res.status(402).json({ error: 'Payment Required: Subscription expired. API key revoked.' });
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
      await pool.query('UPDATE clients SET current_spend_usd = $1 WHERE client_key = $2', [newSpend, req.clientConfig.client_key]);
    }

    await pool.query('INSERT INTO request_logs (client_key, method, endpoint, status_code, cost) VALUES ($1, $2, $3, $4, $5)', [
      req.clientConfig.client_key, req.method, req.originalUrl, statusCode, cost
    ]);

    const logsRes = await pool.query('SELECT * FROM request_logs WHERE client_key = $1 ORDER BY id DESC LIMIT 10', [req.clientConfig.client_key]);

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
      logs: logsRes.rows
    });

    res.status(statusCode);
    response.headers.forEach((value, key) => {
      key = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key)) {
        res.setHeader(key, value);
      }
    });

    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    await pool.query('INSERT INTO request_logs (client_key, method, endpoint, status_code, cost) VALUES ($1, $2, $3, $4, $5)', [
      req.clientConfig?.client_key || 'unknown', req.method, req.originalUrl, 502, 0.00
    ]);
    res.status(502).json({ error: 'Proxy Gateway Error', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[CloudGrip Engine] Live on port ${PORT}`);
});