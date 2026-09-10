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

const db = new Database('/tmp/cloudgrip.db');

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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudGrip AI — High-Speed LLM Proxy Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --border: #1f2937;
      --border-focus: #3b82f6;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #10b981;
      --error-bg: rgba(239, 68, 68, 0.1);
      --error-text: #f87171;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background-image: radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.08) 0%, transparent 50%);
    }

    .wrapper {
      width: 100%;
      max-width: 480px;
    }

    .brand {
      text-align: center;
      margin-bottom: 32px;
    }

    .brand h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #fff;
    }

    .brand p {
      color: var(--text-muted);
      font-size: 14px;
      margin-top: 6px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    }

    .tabs {
      display: flex;
      background: rgba(0, 0, 0, 0.2);
      padding: 4px;
      border-radius: 10px;
      margin-bottom: 24px;
      border: 1px solid var(--border);
    }

    .tab {
      flex: 1;
      text-align: center;
      padding: 10px;
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.2s ease;
    }

    .tab.active {
      background: var(--primary);
      color: #fff;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }

    .pricing-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(16, 185, 129, 0.05);
      border: 1px solid rgba(16, 185, 129, 0.2);
      padding: 12px 16px;
      border-radius: 10px;
      margin-bottom: 24px;
    }

    .pricing-banner .plan {
      font-size: 13px;
      color: var(--accent);
      font-weight: 600;
    }

    .pricing-banner .price {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
    }

    .form-group {
      margin-bottom: 18px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    input {
      width: 100%;
      padding: 12px 16px;
      background: #0b0f19;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: #fff;
      font-size: 14px;
      font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    input:focus {
      outline: none;
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    .btn {
      width: 100%;
      padding: 12px;
      background: var(--primary);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      margin-top: 8px;
    }

    .btn:hover { background: var(--primary-hover); }
    .btn:active { transform: scale(0.99); }

    .btn-danger {
      background: #ef4444;
      margin-top: 16px;
    }
    .btn-danger:hover { background: #dc2626; }

    .hidden { display: none !important; }

    .error-box {
      background: var(--error-bg);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: var(--error-text);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 18px;
    }

    .stat-card {
      background: #0b0f19;
      border: 1px solid var(--border);
      padding: 14px;
      border-radius: 10px;
    }

    .stat-card .label {
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .stat-card .value {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
    }

    .dashboard-view h3 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #fff;
    }

    .dashboard-view p {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }

    .key-box {
      background: #0b0f19;
      border: 1px solid var(--border);
      padding: 12px 14px;
      border-radius: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #38bdf8;
      word-break: break-all;
      margin-bottom: 18px;
    }

    .instruction-note {
      font-size: 12px;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.02);
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      line-height: 1.5;
      margin-bottom: 16px;
    }

    code {
      font-family: 'JetBrains Mono', monospace;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      padding: 2px 4px;
      border-radius: 4px;
    }
  </style>
</head>
<body>

  <div class="wrapper">
    <div class="brand">
      <h1>CloudGrip AI</h1>
      <p>High-Performance LLM Proxy & Anti-Abuse Gateway</p>
    </div>

    <div class="card">
      <div id="auth-container">
        <div class="tabs">
          <div class="tab active" onclick="switchTab('signup')">Sign Up</div>
          <div class="tab" onclick="switchTab('login')">Log In</div>
        </div>

        <div class="pricing-banner">
          <span class="plan"> 7-Day Free Trial Included</span>
          <span class="price">$10<span style="font-size:12px; color:var(--text-muted); font-weight:normal;">/mo</span></span>
        </div>

        <div id="error-msg" class="error-box hidden"></div>

        <!-- Signup Form -->
        <div id="signup-box">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="su-email" placeholder="name@example.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="su-pass" placeholder="Create a secure password">
          </div>
          <button class="btn" onclick="register()">Create Account & Start Trial</button>
          
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 12px; text-align: center; line-height: 1.4;">
            By signing up, you agree to our <a href="/terms" target="_blank" style="color: var(--primary);">Terms of Service</a> and <a href="/privacy" target="_blank" style="color: var(--primary);">Privacy Policy</a>.
          </p>
        </div>

        <!-- Login Form -->
        <div id="login-box" class="hidden">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="li-email" placeholder="name@example.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="li-pass" placeholder="Enter your password">
          </div>
          <button class="btn" onclick="login()">Access Dashboard</button>
        </div>
      </div>

      <!-- Dashboard View -->
      <div id="dashboard" class="dashboard-view hidden">
        <h3>Live Overview</h3>
        <p>Monitor your token spending and active trial duration.</p>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="label">Current Spend</div>
            <div class="value" id="stat-spend">$0.00</div>
          </div>
          <div class="stat-card">
            <div class="label">Trial Time Left</div>
            <div class="value" id="stat-trial">-</div>
          </div>
        </div>

        <label>Your Unique API Key</label>
        <div class="key-box" id="res-key"></div>

        <div class="instruction-note">
          <strong>Integration Tip:</strong> Route your base URL to this server and provide your key via the <code>x-cloudgrip-key</code> header.
        </div>

        <button class="btn btn-danger" onclick="logout()">Sign Out</button>
      </div>
    </div>
  </div>

  <script>
    function switchTab(tab) {
      const suBox = document.getElementById('signup-box');
      const liBox = document.getElementById('login-box');
      const tabs = document.querySelectorAll('.tab');
      hideError();

      if(tab === 'signup') {
        suBox.classList.remove('hidden');
        liBox.classList.add('hidden');
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
      } else {
        suBox.classList.add('hidden');
        liBox.classList.remove('hidden');
        tabs[1].classList.add('active');
        tabs[0].classList.remove('active');
      }
    }

    function showError(msg) {
      const errBox = document.getElementById('error-msg');
      errBox.innerText = msg;
      errBox.classList.remove('hidden');
    }

    function hideError() {
      document.getElementById('error-msg').classList.add('hidden');
    }

    async function register() {
      hideError();
      const email = document.getElementById('su-email').value.trim();
      const password = document.getElementById('su-pass').value;
      const fingerprint = navigator.userAgent + screen.width + screen.height;
      
      if(!email || !password) {
        showError('Please fill in all required fields.');
        return;
      }

      try {
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, fingerprint })
        });
        const data = await res.json();
        if(data.success) {
          showDashboard(data.apiKey);
        } else {
          showError(data.error || 'Registration failed.');
        }
      } catch (err) {
        showError('Network error. Please try again.');
      }
    }

    async function login() {
      hideError();
      const email = document.getElementById('li-email').value.trim();
      const password = document.getElementById('li-pass').value;
      
      if(!email || !password) {
        showError('Please fill in your login details.');
        return;
      }

      try {
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if(data.success) {
          showDashboard(data.apiKey);
        } else {
          showError(data.error || 'Invalid credentials.');
        }
      } catch (err) {
        showError('Network error. Please try again.');
      }
    }

    async function showDashboard(key) {
      document.getElementById('auth-container').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      document.getElementById('res-key').innerText = key;

      // Fetch live user stats
      try {
        const res = await fetch('/client/stats', {
          headers: { 'x-cloudgrip-key': key }
        });
        const data = await res.json();
        if(data.success) {
          document.getElementById('stat-spend').innerText = '$' + data.currentSpendUSD.toFixed(4);
          
          const expires = new Date(data.trialExpiresAt);
          const now = new Date();
          const diffDays = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
          
          if(diffDays > 0) {
            document.getElementById('stat-trial').innerText = diffDays + ' Days Left';
          } else {
            document.getElementById('stat-trial').innerText = 'Expired';
          }
        }
      } catch(e) {
        console.error('Failed to load stats', e);
      }
    }

    function logout() { location.reload(); }
  </script>
</body>
</html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Terms of Service - CloudGrip AI</title><style>body{font-family:sans-serif;background:#090d16;color:#f3f4f6;padding:40px;max-width:700px;margin:auto;line-height:1.6}h1{color:#38bdf8}</style></head><body><h1>Terms of Service</h1><p>Welcome to CloudGrip AI. By using our proxy service, you agree to use it legally and responsibly. Services are provided "as is" without warranty of any kind. We reserve the right to terminate API keys that abuse system resources or engage in malicious activity. We are not liable for any downtime or third-party API interruptions.</p></body></html>`);
});

app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy Policy - CloudGrip AI</title><style>body{font-family:sans-serif;background:#090d16;color:#f3f4f6;padding:40px;max-width:700px;margin:auto;line-height:1.6}h1{color:#38bdf8}</style></head><body><h1>Privacy Policy</h1><p>CloudGrip AI collects your email, encrypted passwords, and basic device information solely for authentication, session management, and preventing trial abuse. We do not sell or share your personal data with third parties.</p></body></html>`);
});

app.get('/client/stats', (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized: Missing key' });

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).json({ error: 'Forbidden: Invalid key' });

  res.json({
    success: true,
    currentSpendUSD: client.current_spend_usd,
    budgetUSD: client.budget_usd,
    trialExpiresAt: client.trial_expires_at,
    status: client.status
  });
});

app.post('/register', async (req, res) => {
  const { email, password, fingerprint } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const existingUser = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (existingUser) {
    return res.status(400).json({ error: 'Email already registered. Please log in.' });
  }

  let grantTrial = true;
  if (fingerprint) {
    const deviceMatch = db.prepare('SELECT * FROM clients WHERE device_fingerprint = ?').get(fingerprint);
    if (deviceMatch) {
      grantTrial = false;
    }
  }

  const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const trialDays = grantTrial ? 7 : 0;
  const trialExpiresAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  const status = grantTrial ? 'trial' : 'expired';
  const budgetUSD = grantTrial ? 0.50 : 0.00;

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
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

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

app.use((req, res, next) => {
  if (['/events', '/register', '/login', '/', '/terms', '/privacy', '/client/stats'].includes(req.path)) return next();

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

app.all(/.*/, async (req, res) => {
  if (['/', '/register', '/login', '/events', '/terms', '/privacy', '/client/stats'].includes(req.path)) return;

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
  console.log(`[CloudGrip Engine] Live on port ${PORT}`);
});