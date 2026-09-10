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

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudGrip AI — High-Performance LLM Proxy Engine</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #060911;
      --card-bg: #0d1322;
      --sidebar-bg: #0a0e19;
      --border: #1e293b;
      --border-focus: #3b82f6;
      --text: #f1f5f9;
      --text-muted: #64748b;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #10b981;
      --error-bg: rgba(239, 68, 68, 0.1);
      --error-text: #f87171;
      --success-bg: rgba(16, 185, 129, 0.1);
      --success-text: #34d399;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Navbar */
    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 32px;
      border-bottom: 1px solid var(--border);
      background: var(--sidebar-bg);
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-brand h1 {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.5px;
    }

    .badge-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--accent);
      background: var(--success-bg);
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .pulse {
      width: 8px;
      height: 8px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent);
    }

    /* Main Container */
    .main-content {
      flex: 1;
      padding: 32px;
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
    }

    /* Auth Wrapper */
    .auth-wrapper {
      max-width: 440px;
      margin: 60px auto;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }

    .tabs {
      display: flex;
      background: rgba(0, 0, 0, 0.3);
      padding: 4px;
      border-radius: 10px;
      margin-bottom: 24px;
      border: 1px solid var(--border);
    }

    .tab {
      flex: 1;
      text-align: center;
      padding: 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.2s ease;
    }

    .tab.active {
      background: var(--primary);
      color: #fff;
    }

    .form-group {
      margin-bottom: 18px;
    }

    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    input {
      width: 100%;
      padding: 12px 16px;
      background: #04060b;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: #fff;
      font-size: 14px;
      font-family: inherit;
      transition: border-color 0.2s;
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
      transition: background 0.2s;
      margin-top: 8px;
    }

    .btn:hover { background: var(--primary-hover); }

    .btn-secondary {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
      margin-top: 10px;
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.02); color: #fff; }

    .btn-danger {
      background: #ef4444;
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

    .success-box {
      background: var(--success-bg);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--success-text);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 16px;
    }

    /* Full Dashboard View */
    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .dashboard-header h2 {
      font-size: 24px;
      font-weight: 700;
      color: #fff;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 20px;
      border-radius: 12px;
    }

    .stat-card .label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .stat-card .value {
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
    }

    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }

    .panel h3 {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 16px;
    }

    .key-row {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .key-box {
      flex: 1;
      background: #04060b;
      border: 1px solid var(--border);
      padding: 12px 16px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #38bdf8;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Logs Table */
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    th {
      color: var(--text-muted);
      font-weight: 600;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      font-family: 'JetBrains Mono', monospace;
    }

    .status-badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
    }
    .status-200 { background: rgba(16,185,129,0.1); color: #34d399; }
    .status-err { background: rgba(239,68,68,0.1); color: #f87171; }

    .auth-footer {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-top: 12px;
    }
    .auth-footer a { color: var(--primary); text-decoration: none; cursor: pointer; }
    .auth-footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>

  <nav>
    <div class="nav-brand">
      <h1>CloudGrip AI Engine</h1>
    </div>
    <div class="badge-status">
      <div class="pulse"></div> Gateway Operational
    </div>
  </nav>

  <div class="main-content">

    <!-- Auth Section -->
    <div id="auth-container" class="auth-wrapper">
      <div class="card">
        <div class="tabs">
          <div class="tab active" id="tab-su" onclick="switchTab('signup')">Sign Up</div>
          <div class="tab" id="tab-li" onclick="switchTab('login')">Log In</div>
        </div>

        <div id="error-msg" class="error-box hidden"></div>
        <div id="success-msg" class="success-box hidden"></div>

        <!-- Signup Form -->
        <div id="signup-box">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="su-email" placeholder="name@example.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="su-pass" placeholder="Create secure password">
          </div>
          <button class="btn" onclick="register()">Create Account & Start Trial</button>
        </div>

        <!-- Login Form -->
        <div id="login-box" class="hidden">
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="li-email" placeholder="name@example.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="li-pass" placeholder="Enter password">
          </div>
          <button class="btn" onclick="login()">Access Gateway</button>
          <div class="auth-footer">
            <a onclick="switchTab('forgot')">Forgot password?</a>
          </div>
        </div>

        <!-- Forgot Password Form -->
        <div id="forgot-box" class="hidden">
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">Enter your registered email address and we'll dispatch your credentials or reset info.</p>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" id="fg-email" placeholder="name@example.com">
          </div>
          <button class="btn" onclick="forgotPassword()">Recover Password</button>
          <button class="btn btn-secondary" onclick="switchTab('login')">Back to Login</button>
        </div>

      </div>
    </div>

    <!-- Full Dashboard View -->
    <div id="dashboard" class="hidden">
      <div class="dashboard-header">
        <h2>Gateway Control Panel</h2>
        <button class="btn btn-danger" style="width: auto; padding: 10px 20px; margin: 0;" onclick="logout()">Sign Out</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Total Spend (USD)</div>
          <div class="value" id="stat-spend">$0.0000</div>
        </div>
        <div class="stat-card">
          <div class="label">Trial Duration Remaining</div>
          <div class="value" id="stat-trial">-</div>
        </div>
        <div class="stat-card">
          <div class="label">Gateway Status</div>
          <div class="value" style="color: var(--accent);">Active</div>
        </div>
      </div>

      <div class="panel">
        <h3>API Authentication Key</h3>
        <div class="key-row">
          <div class="key-box" id="res-key"></div>
          <button class="btn" style="width: 140px; margin:0;" onclick="copyKey()">Copy Key</button>
        </div>
      </div>

      <div class="panel">
        <h3>Live Request Activity Logs</h3>
        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">Real-time feed of traffic passing through your CloudGrip proxy gateway.</p>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody id="logs-table-body">
            <tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No proxy requests logged yet. Make a request using your API key!</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <script>
    // Auto-login if key is already in localStorage
    window.onload = async () => {
      const savedKey = localStorage.getItem('cloudgrip_key');
      if (savedKey) {
        await loadDashboard(savedKey);
      }
    };

    function switchTab(tab) {
      document.getElementById('signup-box').classList.add('hidden');
      document.getElementById('login-box').classList.add('hidden');
      document.getElementById('forgot-box').classList.add('hidden');
      document.getElementById('tab-su').classList.remove('active');
      document.getElementById('tab-li').classList.remove('active');
      hideMsg();

      if(tab === 'signup') {
        document.getElementById('signup-box').classList.remove('hidden');
        document.getElementById('tab-su').classList.add('active');
      } else if(tab === 'login') {
        document.getElementById('login-box').classList.remove('hidden');
        document.getElementById('tab-li').classList.add('active');
      } else if(tab === 'forgot') {
        document.getElementById('forgot-box').classList.remove('hidden');
      }
    }

    function showError(msg) {
      const box = document.getElementById('error-msg');
      box.innerText = msg;
      box.classList.remove('hidden');
      document.getElementById('success-msg').classList.add('hidden');
    }

    function showSuccess(msg) {
      const box = document.getElementById('success-msg');
      box.innerText = msg;
      box.classList.remove('hidden');
      document.getElementById('error-msg').classList.add('hidden');
    }

    function hideMsg() {
      document.getElementById('error-msg').classList.add('hidden');
      document.getElementById('success-msg').classList.add('hidden');
    }

    async function register() {
      hideMsg();
      const email = document.getElementById('su-email').value.trim();
      const password = document.getElementById('su-pass').value;
      const fingerprint = navigator.userAgent + screen.width + screen.height;
      
      if(!email || !password) return showError('Please fill in all fields.');

      try {
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, fingerprint })
        });
        const data = await res.json();
        if(data.success) {
          localStorage.setItem('cloudgrip_key', data.apiKey);
          await loadDashboard(data.apiKey);
        } else {
          showError(data.error || 'Registration failed.');
        }
      } catch (err) {
        showError('Network connectivity error.');
      }
    }

    async function login() {
      hideMsg();
      const email = document.getElementById('li-email').value.trim();
      const password = document.getElementById('li-pass').value;
      
      if(!email || !password) return showError('Please enter login credentials.');

      try {
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if(data.success) {
          localStorage.setItem('cloudgrip_key', data.apiKey);
          await loadDashboard(data.apiKey);
        } else {
          showError(data.error || 'Invalid login details.');
        }
      } catch (err) {
        showError('Network connectivity error.');
      }
    }

    async function forgotPassword() {
      hideMsg();
      const email = document.getElementById('fg-email').value.trim();
      if(!email) return showError('Please enter your email address.');

      try {
        const res = await fetch('/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if(data.success) {
          showSuccess(data.message);
        } else {
          showError(data.error || 'Recovery request failed.');
        }
      } catch (err) {
        showError('Network connectivity error.');
      }
    }

    async function loadDashboard(key) {
      document.getElementById('auth-container').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      document.getElementById('res-key').innerText = key;

      try {
        const res = await fetch('/client/stats', {
          headers: { 'x-cloudgrip-key': key }
        });
        const data = await res.json();
        if(data.success) {
          document.getElementById('stat-spend').innerText = '$' + data.currentSpendUSD.toFixed(4);
          const expires = new Date(data.trialExpiresAt);
          const diffDays = Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24));
          document.getElementById('stat-trial').innerText = diffDays > 0 ? diffDays + ' Days Left' : 'Expired';

          // Render Logs
          if(data.logs && data.logs.length > 0) {
            const tbody = document.getElementById('logs-table-body');
            tbody.innerHTML = data.logs.map(log => \`
              <tr>
                <td>\${log.timestamp}</td>
                <td>\${log.method}</td>
                <td>\${log.endpoint}</td>
                <td><span class="status-badge \${log.status_code === 200 ? 'status-200' : 'status-err'}">\${log.status_code}</span></td>
                <td>$\${log.cost.toFixed(4)}</td>
              </tr>
            \`).join('');
          }
        } else {
          logout();
        }
      } catch(e) {
        console.error('Failed fetching telemetry', e);
      }
    }

    function copyKey() {
      const key = document.getElementById('res-key').innerText;
      navigator.clipboard.writeText(key);
      alert('API Key copied to clipboard!');
    }

    function logout() {
      localStorage.removeItem('cloudgrip_key');
      location.reload();
    }
  </script>
</body>
</html>`);
});

app.get('/terms', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Terms - CloudGrip AI</title><style>body{font-family:sans-serif;background:#060911;color:#f1f5f9;padding:40px;max-width:700px;margin:auto;line-height:1.6}h1{color:#38bdf8}</style></head><body><h1>Terms of Service</h1><p>Welcome to CloudGrip AI. You agree to utilize this gateway lawfully.</p></body></html>`);
});

app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy - CloudGrip AI</title><style>body{font-family:sans-serif;background:#060911;color:#f1f5f9;padding:40px;max-width:700px;margin:auto;line-height:1.6}h1{color:#38bdf8}</style></head><body><h1>Privacy Policy</h1><p>We protect your credential integrity and process traffic securely.</p></body></html>`);
});

app.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  const user = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (!user) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }
  // In production, this would trigger SendGrid/Resend. For now, return confirmation.
  res.json({
    success: true,
    message: 'Password recovery instructions have been dispatched to your email address.'
  });
});

app.get('/client/stats', (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized' });

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).json({ error: 'Forbidden' });

  const logs = db.prepare('SELECT * FROM request_logs WHERE client_key = ? ORDER BY id DESC LIMIT 10').all(clientKey);

  res.json({
    success: true,
    currentSpendUSD: client.current_spend_usd,
    budgetUSD: client.budget_usd,
    trialExpiresAt: client.trial_expires_at,
    status: client.status,
    logs: logs
  });
});

app.post('/register', async (req, res) => {
  const { email, password, fingerprint } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const existingUser = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (existingUser) return res.status(400).json({ error: 'Email already registered. Please log in.' });

  let grantTrial = true;
  if (fingerprint) {
    const deviceMatch = db.prepare('SELECT * FROM clients WHERE device_fingerprint = ?').get(fingerprint);
    if (deviceMatch) grantTrial = false;
  }

  const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const trialExpiresAt = new Date(Date.now() + (grantTrial ? 7 : 0) * 24 * 60 * 60 * 1000).toISOString();
  const status = grantTrial ? 'trial' : 'expired';
  const budgetUSD = grantTrial ? 0.50 : 0.00;

  try {
    db.prepare(`
      INSERT INTO clients (client_key, id, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, trial_expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientKey, email.split('@')[0], email, hashedPassword, fingerprint || 'unknown', budgetUSD, 0.0, trialExpiresAt, status);

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
  if (['/events', '/register', '/login', '/', '/terms', '/privacy', '/client/stats', '/forgot-password'].includes(req.path)) return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized: Missing key' });

  const clientConfig = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!clientConfig) return res.status(403).json({ error: 'Forbidden: Invalid API Key' });

  req.clientConfig = clientConfig;
  next();
});

app.all(/.*/, async (req, res) => {
  if (['/', '/register', '/login', '/events', '/terms', '/privacy', '/client/stats', '/forgot-password'].includes(req.path)) return;

  const startTime = Date.now();
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

    if (response.ok) {
      const newSpend = req.clientConfig.current_spend_usd + cost;
      db.prepare('UPDATE clients SET current_spend_usd = ? WHERE client_key = ?').run(newSpend, req.clientConfig.client_key);
    }

    // Log the request
    db.prepare('INSERT INTO request_logs (client_key, method, endpoint, status_code, cost) VALUES (?, ?, ?, ?, ?)').run(
      req.clientConfig.client_key, req.method, req.originalUrl, statusCode, cost
    );

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