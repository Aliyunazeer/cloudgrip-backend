import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';
import EventEmitter from 'events';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const app = express();
const PORT = process.env.PORT || 5000;
const telemetryEmitter = new EventEmitter();

// --- Initialize SQLite Database ---
const db = new Database('cloudgrip.db');

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
    status TEXT DEFAULT 'trial'
  )
`);

// --- Express Middleware Setup ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- Built-in Frontend UI (Landing, Login, & Dashboard) ---
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CloudGrip AI - High-Speed LLM Proxy</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px; display: flex; justify-content: center; }
    .container { max-width: 600px; width: 100%; background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #38bdf8; margin-top: 0; font-size: 24px; }
    .price-tag { font-size: 28px; font-weight: bold; color: #4ade80; margin: 15px 0; }
    input, button { width: 100%; padding: 12px; margin: 8px 0 16px 0; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #fff; box-sizing: border-box; }
    button { background: #38bdf8; color: #0f172a; font-weight: bold; border: none; cursor: pointer; }
    button:hover { background: #0ea5e9; }
    .hidden { display: none; }
    pre { background: #0f172a; padding: 15px; border-radius: 6px; overflow-x: auto; color: #38bdf8; }
    .tab { cursor: pointer; padding: 10px 20px; display: inline-block; background: #334155; margin-right: 5px; border-radius: 6px 6px 0 0; }
    .tab.active { background: #1e293b; color: #38bdf8; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>CloudGrip AI Proxy Engine</h1>
    <div class="price-tag">$10 / month <span style="font-size: 14px; color: #94a3b8; font-weight: normal;">(Includes 7-Day Free Trial)</span></div>
    
    <div>
      <span class="tab active" onclick="switchTab('signup')">Sign Up</span>
      <span class="tab" onclick="switchTab('login')">Log In</span>
    </div>

    <div id="signup-box" style="background: #1e293b; padding-top: 15px;">
      <p style="color: #94a3b8; font-size: 14px;">Create your account to instantly claim your 7-day trial key.</p>
      <input type="email" id="su-email" placeholder="Email Address">
      <input type="password" id="su-pass" placeholder="Password">
      <button onclick="register()">Start 7-Day Free Trial</button>
    </div>

    <div id="login-box" class="hidden" style="background: #1e293b; padding-top: 15px;">
      <input type="email" id="li-email" placeholder="Email Address">
      <input type="password" id="li-pass" placeholder="Password">
      <button onclick="login()">Access Dashboard & Key</button>
    </div>

    <div id="dashboard" class="hidden">
      <h3>Your Active API Credentials</h3>
      <p><strong>API Key:</strong></p>
      <pre id="res-key"></pre>
      <p><strong>How to use in your code / apps:</strong></p>
      <p style="font-size: 13px; color: #94a3b8;">Point your base URL to this server and use header <code>x-cloudgrip-key</code>.</p>
      <button style="background: #ef4444; color: #fff;" onclick="logout()">Log Out</button>
    </div>
    <p id="error-msg" style="color: #f87171;"></p>
  </div>

  <script>
    function switchTab(tab) {
      if(tab === 'signup') {
        document.getElementById('signup-box').classList.remove('hidden');
        document.getElementById('login-box').classList.add('hidden');
        document.querySelectorAll('.tab')[0].classList.add('active');
        document.querySelectorAll('.tab')[1].classList.remove('active');
      } else {
        document.getElementById('signup-box').classList.add('hidden');
        document.getElementById('login-box').classList.remove('hidden');
        document.querySelectorAll('.tab')[1].classList.add('active');
        document.querySelectorAll('.tab')[0].classList.remove('active');
      }
    }

    async function register() {
      const email = document.getElementById('su-email').value;
      const password = document.getElementById('su-pass').value;
      const fingerprint = navigator.userAgent + screen.width + screen.height; // Device anti-abuse tracker
      
      const res = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fingerprint })
      });
      const data = await res.json();
      if(data.success) {
        showDashboard(data.apiKey);
      } else {
        document.getElementById('error-msg').innerText = data.error;
      }
    }

    async function login() {
      const email = document.getElementById('li-email').value;
      const password = document.getElementById('li-pass').value;
      
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if(data.success) {
        showDashboard(data.apiKey);
      } else {
        document.getElementById('error-msg').innerText = data.error;
      }
    }

    function showDashboard(key) {
      document.getElementById('signup-box').classList.add('hidden');
      document.getElementById('login-box').classList.add('hidden');
      document.querySelectorAll('.tab')[0].style.display = 'none';
      document.querySelectorAll('.tab')[1].style.display = 'none';
      document.getElementById('dashboard').classList.remove('hidden');
      document.getElementById('res-key').innerText = key;
    }

    function logout() { location.reload(); }
  </script>
</body>
</html>`);
});

// --- Registration Endpoint with Device Anti-Abuse Check ---
app.post('/register', async (req, res) => {
  const { email, password, fingerprint } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // Check if email already exists
  const existingUser = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (existingUser) {
    return res.status(400).json({ error: 'Email already registered. Please log in.' });
  }

  // Check device fingerprint to prevent same device creating multi free trials
  let grantTrial = true;
  if (fingerprint) {
    const deviceMatch = db.prepare('SELECT * FROM clients WHERE device_fingerprint = ?').get(fingerprint);
    if (deviceMatch) {
      grantTrial = false; // Deny free trial, force paid subscription mode
    }
  }

  const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const trialDays = grantTrial ? 7 : 0; // 0 days trial if device already used
  const trialExpiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const status = grantTrial ? 'trial' : 'expired';
  const budgetUSD = grantTrial ? 0.50 : 0.00; // No free budget if trial is denied

  try {
    db.prepare(`
      INSERT INTO clients (client_key, id, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, trial_expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientKey, email.split('@')[0], email, hashedPassword, fingerprint || 'unknown', budgetUSD, 0.0, trialExpiresAt, status);

    res.json({
      success: true,
      message: grantTrial ? '7-day free trial activated!' : 'Device already claimed a free trial. Subscription required.',
      apiKey: clientKey,
      trialActive: grantTrial
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error during registration.' });
  }
});

// --- Login Endpoint ---
app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  res.json({
    success: true,
    apiKey: user.client_key
  });
});

// --- Authentication & Proxy Middleware ---
app.use((req, res, next) => {
  if (req.path === '/events' || req.path === '/register' || req.path === '/login' || req.path === '/') return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized: Missing x-cloudgrip-key header' });

  const clientConfig = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!clientConfig) return res.status(403).json({ error: 'Forbidden: Invalid API Key' });

  if (new Date() > new Date(clientConfig.trial_expires_at)) {
    return res.status(403).json({ error: 'Trial Expired', message: 'Your free trial has expired. Please pay $10/month to continue.' });
  }

  req.clientConfig = {
    id: clientConfig.id,
    key: clientConfig.client_key,
    budgetUSD: clientConfig.budget_usd,
    currentSpendUSD: clientConfig.current_spend_usd
  };
  next();
});

// --- Transparent Proxy Handler ---
app.all(/.*/, async (req, res) => {
  if (req.path === '/events' || req.path === '/register' || req.path === '/login' || req.path === '/') return;

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

    if (response.ok) {
      const newSpend = req.clientConfig.currentSpendUSD + 0.01;
      db.prepare('UPDATE clients SET current_spend_usd = ? WHERE client_key = ?').run(newSpend, req.clientConfig.key);
    }

    res.status(response.status);
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
    res.status(502).json({ error: 'Proxy Gateway Error', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[CloudGrip Engine] Live on port ${PORT} with UI & anti-abuse protection.`);
});