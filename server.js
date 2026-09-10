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
      max-width: 1280px;
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
      background: rgba(59, 130, 246, 0.05);
      border: 1px solid rgba(59, 130, 246, 0.15);
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
      color: #60a5fa;
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

    .dashboard-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }

    @media(max-width: 960px) {
      .dashboard-grid {
        grid-template-columns: 1fr;
      }
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

    /* Live Telemetry Terminal Window */
    .terminal-window {
      background: #040507;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11.5px;
      height: 280px;
      overflow-y: auto;
      padding: 14px;
      color: #34d399;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .terminal-line {
      display: flex;
      gap: 10px;
      animation: fadeInTerm 0.2s ease-out forwards;
    }

    @keyframes fadeInTerm {
      from { opacity: 0; transform: translateY(2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .term-time { color: var(--text-dim); }
    .term-method { color: #60a5fa; font-weight: 600; }
    .term-path { color: #f3f4f6; flex: 1; }
    .term-status { color: #34d399; }
    .term-status.err { color: #f87171; }
    .term-cost { color: #fbbf24; }

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
            <span class="plan-name">7-Day Free Trial / Subscription Model</span>
            <span class="plan-price">$0.00 Initial</span>
          </div>
          <div class="form-group">
            <label>Work Email</label>
            <input type="email" id="su-email" placeholder="name@company.com">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="su-pass" placeholder="Create a secure password">
          </div>
          <div class="form-group">
            <label>Initial Credit / Budget Cap ($ USD)</label>
            <input type="number" id="su-budget" value="10.00" step="1" min="1">
          </div>
          <button class="btn" onclick="register()">Start 7-Day Trial & Create Account</button>
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
          <button class="btn" onclick="forgotPassword()">Email Password Recovery</button>
          <button class="btn btn-secondary" onclick="switchTab('login')">Back to Sign In</button>
        </div>

      </div>
    </div>

    <!-- Full Dashboard View -->
    <div id="dashboard" class="dashboard-container hidden">
      <div class="dashboard-header">
        <div>
          <h2>Overview & Live Telemetry</h2>
          <p>Real-time gateway activity stream and account metrics.</p>
        </div>
        <button class="btn btn-danger" style="width: auto; padding: 0 16px; margin: 0;" onclick="logout()">Sign Out</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">Available Balance / Credit</div>
          <div class="value" id="stat-spend">$0.0000</div>
        </div>
        <div class="stat-card">
          <div class="label">Subscription Status</div>
          <div class="value" id="stat-status" style="font-size: 16px; display: flex; align-items: center; height: 32px; color: var(--success-text);">Active Trial</div>
        </div>
        <div class="stat-card">
          <div class="label">Trial Expires On</div>
          <div class="value" id="stat-expiry" style="font-size: 14px; display: flex; align-items: center; height: 32px; color: #60a5fa;">--</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="panel" style="margin-bottom:0;">
          <h3>API Authentication Key</h3>
          <p>Include this key in your request headers via <code>x-cloudgrip-key</code> to authenticate traffic through the proxy layer.</p>
          <div class="key-row">
            <div class="key-box" id="res-key"></div>
            <button class="btn" style="width: 110px; margin:0;" onclick="copyKey()">Copy Key</button>
          </div>

          <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 20px;">
            <h3>Payment Method & Subscription Top-Up</h3>
            <p>Add funds or renew your subscription tier via Paystack to maintain uninterrupted API proxy access.</p>
            <div class="key-row">
              <input type="number" id="update-budget-input" step="5" min="5" style="flex:1;" placeholder="Amount in NGN (e.g. 5000)">
              <button class="btn" style="width: 140px; margin:0;" onclick="updateBudget()">Make Payment</button>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-bottom:0;">
          <div class="panel-header" style="margin-bottom:12px;">
            <h3>Live Telemetry Stream</h3>
            <span style="font-size: 11px; color: var(--success-text); display:inline-flex; align-items:center; gap:4px;"><div class="pulse"></div> Streaming live</span>
          </div>
          <div class="terminal-window" id="terminal-stream">
            <div class="terminal-line"><span class="term-time">[00:00:00]</span> Connecting to CloudGrip telemetry stream...</div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top: 20px;">
        <div class="panel-header">
          <h3>Request Activity Logs</h3>
          <span style="font-size: 12px; color: var(--text-muted);">Historical proxy calls</span>
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
    let eventSource = null;

    window.onload = async () => {
      // Check query params for payment redirect notification
      const urlParams = new URLSearchParams(window.location.search);
      const paymentStatus = urlParams.get('payment');
      if (paymentStatus === 'success') {
        alert('Payment successful via Paystack! Your balance and account key have been updated.');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (paymentStatus === 'failed') {
        alert('Payment verification failed or was cancelled.');
        window.history.replaceState({}, document.title, window.location.pathname);
      }

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
        descEl.innerText = "Start your 7-day trial or make a subscription payment.";
      } else if(tab === 'login') {
        document.getElementById('login-box').classList.remove('hidden');
        document.getElementById('tab-li').classList.add('active');
        titleEl.innerText = "Welcome back";
        descEl.innerText = "Enter your credentials to access your gateway control panel.";
      } else if(tab === 'forgot') {
        document.getElementById('forgot-box').classList.remove('hidden');
        titleEl.innerText = "Reset password";
        descEl.innerText = "Enter your registered email to receive your password securely.";
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
      const budget = parseFloat(document.getElementById('su-budget').value) || 10.00;
      const fingerprint = navigator.userAgent + screen.width + screen.height + (navigator.language || 'en');
      
      if(!email || !password) return showError('All fields are required.');

      try {
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, budget, fingerprint })
        });
        const data = await res.json();
        if(data.success) {
          localStorage.setItem('cloudgrip_key', data.apiKey);
          await loadDashboard(data.apiKey);
        } else if(data.requiresPayment) {
          showError('Device security check: An account has already been registered from this browser/device. Please submit a payment or subscription fee to complete creation.');
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
          document.getElementById('update-budget-input').value = data.budgetUSD;
          document.getElementById('stat-expiry').innerText = new Date(data.trialExpiresAt).toLocaleDateString();

          const statusEl = document.getElementById('stat-status');
          if(data.status === 'expired') {
            statusEl.innerText = 'Trial Expired / Blocked';
            statusEl.style.color = 'var(--error-text)';
          } else {
            statusEl.innerText = 'Active Paid Tier';
            statusEl.style.color = 'var(--success-text)';
          }

          if(data.logs && data.logs.length > 0) {
            updateLogsTable(data.logs);
          }
          initEventStream(key);
        } else {
          logout();
        }
      } catch(e) {
        console.error('Failed fetching stats', e);
      }
    }

    // Real Paystack Checkout Integration
    async function updateBudget() {
      const key = localStorage.getItem('cloudgrip_key');
      const addAmount = parseFloat(document.getElementById('update-budget-input').value);
      if(isNaN(addAmount) || addAmount <= 0) return alert('Please enter a valid amount.');

      try {
        const res = await fetch('/api/topup/initialize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cloudgrip-key': key },
          body: JSON.stringify({ amount: addAmount })
        });
        const data = await res.json();
        if(data.status && data.authorization_url) {
          // Redirect securely to Paystack real checkout page
          window.location.href = data.authorization_url;
        } else {
          alert(data.error || 'Failed to initialize Paystack checkout.');
        }
      } catch(e) {
        alert('Network connectivity error connecting to payment gateway.');
      }
    }

    function updateLogsTable(logs) {
      const tbody = document.getElementById('logs-table-body');
      tbody.innerHTML = logs.map(log => `
        function updateLogsTable(logs) {
      const tbody = document.getElementById('logs-table-body');
      tbody.innerHTML = logs.map(log => `
        <tr>
          <td>${log.timestamp}</td>
          <td>${log.method}</td>
          <td>${log.endpoint}</td>
          <td><span class="status-badge ${log.status_code === 200 ? 'status-200' : 'status-err'}">${log.status_code}</span></td>           <td>$${log.cost.toFixed(4)}</td>
        </tr>
      `).join('');
    }
      `).join('');
    }

    function initEventStream(key) {
      if(eventSource) eventSource.close();
      eventSource = new EventSource('/events?cloudgrip_key=' + encodeURIComponent(key));
      
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if(payload.type === 'telemetry') {
            const log = payload.log;
            
            // Append to terminal
            const term = document.getElementById('terminal-stream');
            const timeStr = new Date().toTimeString().split(' ')[0];
            const line = document.createElement('div');
            line.className = 'terminal-line';
            line.innerHTML = `<span class="term-time">[${timeStr}]</span> <span class="term-method">${log.method}</span> <span class="term-path">${log.endpoint}</span> <span class="term-status ${log.status_code !== 200 ? 'err' : ''}">[${log.status_code}]</span> <span class="term-cost">$${log.cost.toFixed(4)}</span>`;
            term.appendChild(line);
            term.scrollTop = term.scrollHeight;

            // Refresh stats & table
            if(payload.currentSpendUSD !== undefined) {
              document.getElementById('stat-spend').innerText = '$' + payload.currentSpendUSD.toFixed(4);
            }
            if(payload.logs) {
              updateLogsTable(payload.logs);
            }
          }
        } catch(err) {
          console.error('Stream parse error', err);
        }
      };
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
      if(eventSource) eventSource.close();
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
    message: 'Your account credentials and secure API key recovery instructions have been sent to your email.'
  });
});

app.get('/client/stats', (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized' });

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).json({ error: 'Forbidden' });

  // Check trial expiration
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

// --- PAYSTACK REAL PAYMENT INTEGRATION ROUTES ---

// 1. Initialize Real Paystack Transaction
app.post('/api/topup/initialize', async (req, res) => {
  const clientKey = req.headers['x-cloudgrip-key'];
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized' });

  const client = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!client) return res.status(403).json({ error: 'Forbidden' });

  const { amount } = req.body || {}; // amount in NGN or USD depending on your account currency
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
      amount: Math.round(amount * 100), // Paystack expects amount in Kobo/lowest currency unit
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

// 2. Verify Paystack Transaction Callback & Credit Account
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
        // Convert top-up value appropriately (e.g. mapping NGN top-up to USD value or adding direct numeric credit)
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

  // Device fingerprint anti-abuse check
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
  const trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7-day trial
  const status = 'active';
  const initialCredit = 0.00; // No free welcome credit

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
  if (['/events', '/register', '/login', '/', '/terms', '/privacy', '/client/stats', '/api/topup/initialize', '/api/topup/verify', '/forgot-password'].includes(req.path)) return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey) return res.status(401).json({ error: 'Unauthorized: Missing key' });

  const clientConfig = db.prepare('SELECT * FROM clients WHERE client_key = ?').get(clientKey);
  if (!clientConfig) return res.status(403).json({ error: 'Forbidden: Invalid API Key' });

  // Enforce Trial Expiration and Payment Block
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
  if (['/', '/register', '/login', '/events', '/terms', '/privacy', '/client/stats', '/api/topup/initialize', '/api/topup/verify', '/forgot-password'].includes(req.path)) return;

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