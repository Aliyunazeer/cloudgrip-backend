import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';
import EventEmitter from 'events';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 5000;
const telemetryEmitter = new EventEmitter();

// Ensure persistent storage directory if mounted via volume (e.g. Render/Railway persistent disk)
const dataDir = process.env.DATA_DIR || '/tmp';
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    // fallback
  }
}
const dbPath = path.join(dataDir, 'cloudgrip.db');
const db = new Database(dbPath);

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
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudGrip — High-Performance LLM Proxy & Anti-Abuse Gateway</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: #0f1117;
      --card-hover: #141721;
      --border: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.16);
      --border-focus: #3b82f6;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
      --primary: #ffffff;
      --primary-hover: #e5e7eb;
      --primary-text: #090a0f;
      --accent: #10b981;
      --accent-glow: rgba(16, 185, 129, 0.15);
      --error-bg: rgba(239, 68, 68, 0.08);
      --error-border: rgba(239, 68, 68, 0.2);
      --error-text: #f87171;
      --success-bg: rgba(16, 185, 129, 0.08);
      --success-text: #34d399;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 14px;
      --transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Navbar */
    nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 64px;
      padding: 0 32px;
      border-bottom: 1px solid var(--border);
      background: rgba(9, 10, 15, 0.75);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 50;
    }

    .nav-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .nav-brand svg {
      width: 20px;
      height: 20px;
      color: #fff;
    }

    .nav-brand h1 {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.2px;
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--success-text);
      background: var(--success-bg);
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .pulse {
      width: 6px;
      height: 6px;
      background: var(--accent);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--accent);
    }

    /* Main Container */
    .main-content {
      flex: 1;
      padding: 48px 24px;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    /* Auth Wrapper */
    .auth-wrapper {
      max-width: 380px;
      width: 100%;
      margin: 0 auto;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 28px;
      box-shadow: 0 4px 24px -2px rgba(0, 0, 0, 0.5);
      transition: var(--transition);
    }

    .card-header {
      margin-bottom: 24px;
    }

    .card-header h2 {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.3px;
      margin-bottom: 6px;
    }

    .card-header p {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .tabs {
      display: flex;
      background: rgba(255, 255, 255, 0.03);
      padding: 3px;
      border-radius: var(--radius-md);
      margin-bottom: 24px;
      border: 1px solid var(--border);
    }

    .tab {
      flex: 1;
      text-align: center;
      padding: 7px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 7px;
      transition: var(--transition);
    }

    .tab:hover {
      color: var(--text);
    }

    .tab.active {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }

    .pricing-banner {
      background: rgba(16, 185, 129, 0.05);
      border: 1px solid rgba(16, 185, 129, 0.15);
      border-radius: var(--radius-sm);
      padding: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .pricing-banner .plan-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--success-text);
    }

    .pricing-banner .plan-price {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
    }

    .form-group {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 6px;
      letter-spacing: -0.1px;
    }

    input {
      width: 100%;
      height: 38px;
      padding: 0 12px;
      background: #06070a;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: #fff;
      font-size: 13px;
      font-family: inherit;
      transition: var(--transition);
    }

    input:hover {
      border-color: var(--border-hover);
    }

    input:focus {
      outline: none;
      border-color: #fff;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.15);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 38px;
      background: var(--primary);
      color: var(--primary-text);
      font-size: 13px;
      font-weight: 500;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: var(--transition);
      margin-top: 6px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }

    .btn:hover {
      background: var(--primary-hover);
      transform: translateY(-0.5px);
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn-secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
      margin-top: 8px;
    }
    
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: var(--border-hover);
      color: #fff;
    }

    .btn-danger {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .btn-danger:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
    }

    .hidden { display: none !important; }

    .error-box {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: var(--error-text);
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .success-box {
      background: var(--success-bg);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--success-text);
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      margin-bottom: 16px;
      line-height: 1.4;
    }

    /* Dashboard View */
    .dashboard-container {
      width: 100%;
      animation: fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .dashboard-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .dashboard-header h2 {
      font-size: 20px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.4px;
      margin-bottom: 4px;
    }

    .dashboard-header p {
      font-size: 13px;
      color: var(--text-muted);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 20px;
      border-radius: var(--radius-md);
      transition: var(--transition);
    }

    .stat-card:hover {
      border-color: var(--border-hover);
    }

    .stat-card .label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 8px;
      letter-spacing: -0.1px;
    }

    .stat-card .value {
      font-size: 24px;
      font-weight: 600;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: -0.5px;
    }

    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 24px;
      margin-bottom: 20px;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .panel h3 {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.2px;
    }

    .panel p {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
      line-height: 1.4;
    }

    .key-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .key-box {
      flex: 1;
      height: 38px;
      background: #06070a;
      border: 1px solid var(--border);
      padding: 0 12px;
      display: flex;
      align-items: center;
      border-radius: var(--radius-sm);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #60a5fa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Table */
    .table-container {
      width: 100%;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: #06070a;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 12px;
      white-space: nowrap;
    }

    th {
      color: var(--text-muted);
      font-weight: 500;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.01);
      letter-spacing: -0.1px;
    }

    td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      font-family: 'JetBrains Mono', monospace;
      color: var(--text);
    }

    tr:last-child td {
      border-bottom: none;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    .status-200 { background: rgba(16,185,129,0.1); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }
    .status-err { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }

    .auth-footer {
      display: flex;
      justify-content: flex-end;
      font-size: 12px;
      margin-top: 10px;
    }
    .auth-footer a { color: var(--text-muted); text-decoration: none; cursor: pointer; transition: var(--transition); }
    .auth-footer a:hover { color: #fff; }

    /* Footer Meta */
    .site-footer {
      padding: 24px 32px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: var(--text-dim);
    }
    .site-footer a { color: var(--text-muted); text-decoration: none; margin-left: 16px; }
    .site-footer a:hover { color: #fff; }
  </style>
</head>
<body>

  <nav>
    <div class="nav-brand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      <h1>CloudGrip Gateway</h1>
    </div>
    <div class="nav-right">
      <div class="badge-status">
        <div class="pulse"></div> Operational
      </div>
    </div>
  </nav>

  <div class="main-content">

    <!-- Auth Section -->
    <div id="auth-container" class="auth-wrapper">
      <div class="card">
        <div id="auth-header-el" class="card-header">
          <h2 id="auth-title">Welcome back</h2>
          <p id="auth-desc">Enter your credentials to access your gateway control panel.</p>
        </div>

        <div class="tabs">
          <div class="tab" id="tab-su" onclick="switchTab('signup')">Sign Up</div>
          <div class="tab active" id="tab-li" onclick="switchTab('login')">Log In</div>
        </div>

        <div id="error-msg" class="error-box hidden"></div>
        <div id="success-msg" class="success-box hidden"></div>

        <!-- Signup Form -->
        <div id="signup-box" class="hidden">
          <div class="pricing-banner">
            <span class="plan-name">Pro Starter Credit</span>
            <span class="plan-price">$10.00 / initial load</span>
          </div>
          <div class="form-group">
            <label>Work Email</label>
            <input type="email" id="su-email" placeholder="name@company.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="su-pass" placeholder="Create a secure password">
          </div>
          <button class="btn" onclick="register()">Create Account & Add $10 Credit</button>
        </div>

        <!-- Login Form -->
        <div id="login-box">
          <div class="form-group">
            <label>Work Email</label>
            <input type="email" id="li-email" placeholder="name@company.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="li-pass" placeholder="••••••••••••">
          </div>
          <button class="btn" onclick="login()">Sign In</button>
          <div class="auth-footer">
            <a onclick="switchTab('forgot')">Forgot password?</a>
          </div>
        </div>

        <!-- Forgot Password Form -->
        <div id="forgot-box" class="hidden">
          <div class="form-group">
            <label>Work Email</label>
            <input type="email" id="fg-email" placeholder="name@company.com">
          </div>
          <button class="btn" onclick="forgotPassword()">Send Reset Instructions</button>
          <button class="btn btn-secondary" onclick="switchTab('login')">Back to Sign In</button>
        </div>

      </div>
    </div>

    <!-- Full Dashboard View -->
    <div id="dashboard" class="dashboard-container hidden">
      <div class="dashboard-header">
        <div>
          <h2>Overview</h2>
          <p>Real-time analytics and proxy performance metrics.</p>
        </div>
        <button class="btn btn-danger" style="width: auto; padding: 0 16px; margin: 0;" onclick="logout()">Sign Out</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Account Balance / Credit</div>
          <div class="value" id="stat-spend">$0.0000</div>
        </div>
        <div class="stat-card">
          <div class="label">Trial Duration Remaining</div>
          <div class="value" id="stat-trial">-</div>
        </div>
        <div class="stat-card">
          <div class="label">Gateway State</div>
          <div class="value" style="color: var(--success-text); font-size: 18px; display: flex; align-items: center; height: 32px;">Active Proxy</div>
        </div>
      </div>

      <div class="panel">
        <h3>API Authentication Key</h3>
        <p>Include this key in your request headers via <code>x-cloudgrip-key</code> to authenticate traffic through the proxy layer.</p>
        <div class="key-row">
          <div class="key-box" id="res-key"></div>
          <button class="btn" style="width: 110px; margin:0;" onclick="copyKey()">Copy Key</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h3>Request Activity Logs</h3>
          <span style="font-size: 12px; color: var(--text-muted);">Last 10 proxy calls</span>
        </div>
        <div class="table-container">
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
              <tr><td colspan="5" style="text-align: center; color: var(--text-muted); font-family: inherit; padding: 24px;">No proxy traffic recorded yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </div>

  <footer class="site-footer">
    <div>&copy; 2026 CloudGrip AI, Inc. All rights reserved.</div>
    <div>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </div>
  </footer>

  <script>
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

      const titleEl = document.getElementById('auth-title');
      const descEl = document.getElementById('auth-desc');

      if(tab === 'signup') {
        document.getElementById('signup-box').classList.remove('hidden');
        document.getElementById('tab-su').classList.add('active');
        titleEl.innerText = "Create an account";
        descEl.innerText = "Get started with your gateway account and $10 starting balance.";
      } else if(tab === 'login') {
        document.getElementById('login-box').classList.remove('hidden');
        document.getElementById('tab-li').classList.add('active');
        titleEl.innerText = "Welcome back";
        descEl.innerText = "Enter your credentials to access your gateway control panel.";
      } else if(tab === 'forgot') {
        document.getElementById('forgot-box').classList.remove('hidden');
        titleEl.innerText = "Reset password";
        descEl.innerText = "Enter your registered email to receive recovery instructions.";
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
      
      if(!email || !password) return showError('All fields are required.');

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
      
      if(!email || !password) return showError('Please provide your login credentials.');

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
          showError(data.error || 'Invalid email or password.');
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
          document.getElementById('stat-trial').innerText = diffDays > 0 ? diffDays + ' Days Remaining' : 'Active Paid Tier';

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
        console.error('Failed fetching stats', e);
      }
    }

    function copyKey() {
      const key = document.getElementById('res-key').innerText;
      navigator.clipboard.writeText(key);
      const btn = event.target;
      const originalText = btn.innerText;
      btn.innerText = 'Copied!';
      setTimeout(() => btn.innerText = originalText, 1500);
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
    message: 'Password reset instructions have been dispatched to your email.'
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
  if (existingUser) return res.status(400).json({ error: 'Email already registered. Please sign in.' });

  const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
  const hashedPassword = await bcrypt.hash(password, 10);
  const trialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const status = 'active';
  const initialCredit = 10.00;

  try {
    db.prepare(`
      INSERT INTO clients (client_key, id, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, trial_expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientKey, email.split('@')[0], email, hashedPassword, fingerprint || 'unknown', initialCredit, initialCredit, trialExpiresAt, status);

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
      const newSpend = Math.max(0, req.clientConfig.current_spend_usd - cost);
      db.prepare('UPDATE clients SET current_spend_usd = ? WHERE client_key = ?').run(newSpend, req.clientConfig.client_key);
    }

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