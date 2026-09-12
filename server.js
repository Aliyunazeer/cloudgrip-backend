import 'dotenv/config';
import express from 'express';
import session from 'express-session';
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

// Connect to Supabase PostgreSQL (forced to IPv4 to prevent Render ENETUNREACH network errors)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Setup session support for admin authentication
app.use(session({
  secret: process.env.SESSION_SECRET || 'cloudgrip-secure-admin-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Simple admin authentication middleware
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

// Track Website Visits Middleware for Homepage (ignoring browser prefetch/prerender requests)
app.use(async (req, res, next) => {
  if (req.path === '/' && req.method === 'GET') {
    const purpose = req.headers['purpose'] || req.headers['sec-purpose'] || req.headers['x-moz'];
    const isPrefetch = purpose && (purpose.includes('prefetch') || purpose.includes('prerender'));

    if (!isPrefetch) {
      try {
        await pool.query('INSERT INTO site_visits (visited_at) VALUES (NOW())');
      } catch (err) {
        console.error('Error logging site visit:', err.message);
      }
    }
  }
  next();
});

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

// Admin Login View
app.get('/admin/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>CloudGrip Admin Login</title>
      <style>
        body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; height: 100vh; align-items: center; justify-content: center; margin: 0; }
        .login-card { background: #131b2e; border: 1px solid #1e293b; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); width: 300px; }
        h2 { margin-top: 0; margin-bottom: 20px; font-size: 20px; color: #fff; text-align: center; }
        input { width: 100%; box-sizing: border-box; padding: 12px; margin-bottom: 15px; background: #0b0f19; border: 1px solid #334155; color: #fff; border-radius: 4px; font-size: 14px; }
        button { width: 100%; padding: 12px; background: #10b981; border: none; color: #fff; font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 14px; }
        button:hover { background: #059669; }
      </style>
    </head>
    <body>
      <div class="login-card">
        <h2>CloudGrip Admin</h2>
        <form action="/admin/login" method="POST">
          <input type="password" name="password" placeholder="Enter admin password" required autofocus />
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Handle Login Form Submission
app.post('/admin/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.password === 'admin123') {
    req.session.isAdmin = true;
    return res.redirect('/analytics');
  }
  res.send('<script>alert("Wrong password!"); window.location.href="/admin/login";</script>');
});

// Logout Route
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// Admin Route to Reset User Spend Limit back to $0.00
app.post('/admin/reset-spend', requireAdmin, express.urlencoded({ extended: true }), async (req, res) => {
  const { clientId } = req.body;
  if (clientId) {
    await pool.query('UPDATE clients SET current_spend_usd = 0.00 WHERE id = $1', [clientId]);
  }
  res.redirect('/analytics');
});

// Protected Custom Analytics Dashboard Route
app.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const usersCountRes = await pool.query('SELECT COUNT(*) FROM clients');
    const activeSubsRes = await pool.query("SELECT COUNT(*) FROM clients WHERE status = 'active'");
    const totalRequestsRes = await pool.query('SELECT COUNT(*) FROM request_logs');
    const siteVisitsRes = await pool.query('SELECT COUNT(*) FROM site_visits');
    const clientsRes = await pool.query('SELECT id, email, current_spend_usd, budget_cap_usd, status FROM clients ORDER BY id DESC');
    
    const chartDataRes = await pool.query(`
      SELECT TO_CHAR(timestamp, 'Dy') as day, COUNT(*) as count 
      FROM request_logs 
      WHERE timestamp >= NOW() - INTERVAL '7 days' 
      GROUP BY TO_CHAR(timestamp, 'Dy'), DATE(timestamp) 
      ORDER BY DATE(timestamp) ASC
    `);

    const totalUsers = parseInt(usersCountRes.rows[0]?.count || 0);
    const activeSubs = parseInt(activeSubsRes.rows[0]?.count || 0);
    const totalRevenue = (activeSubs * 15.00).toFixed(2);
    const proxyRequests = parseInt(totalRequestsRes.rows[0]?.count || 0);
    const siteVisits = parseInt(siteVisitsRes.rows[0]?.count || 0);

    const chartLabels = chartDataRes.rows.map(r => r.day);
    const chartValues = chartDataRes.rows.map(r => parseInt(r.count));

    let clientsTableHtml = clientsRes.rows.map(c => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">${c.email}</td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;">$${parseFloat(c.current_spend_usd).toFixed(2)} / $${c.budget_cap_usd}</td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b;"><span style="padding: 4px 8px; border-radius: 4px; font-size: 11px; background: ${c.status === 'active' ? 'rgba(16, 185, 129, 0.2); color: #10b981;' : 'rgba(239, 68, 68, 0.2); color: #ef4444;'}">${c.status}</span></td>
        <td style="padding: 12px; border-bottom: 1px solid #1e293b; text-align: right;">
          <form action="/admin/reset-spend" method="POST" style="margin:0;">
            <input type="hidden" name="clientId" value="${c.id}" />
            <button type="submit" style="padding: 6px 12px; background: #3b82f6; border: none; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">Refresh Cap ($0)</button>
          </form>
        </td>
      </tr>
    `).join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>CloudGrip Analytics</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          body { background: #0b0f19; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 30px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 15px; margin-bottom: 25px; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 30px; }
          .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
          .card h3 { margin: 0 0 10px 0; font-size: 14px; color: #94a3b8; font-weight: 500; }
          .card .value { font-size: 28px; font-weight: 700; color: #fff; }
          .card .subtext { font-size: 12px; color: #10b981; margin-top: 5px; }
          .section { background: #131b2e; border: 1px solid #1e293b; border-radius: 8px; padding: 20px; margin-bottom: 30px; }
          table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; color: #cbd5e1; }
          th { padding: 12px; border-bottom: 1px solid #334155; color: #94a3b8; font-weight: 500; }
          a.logout { color: #ef4444; text-decoration: none; font-size: 14px; padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border-radius: 4px; }
          a.logout:hover { background: rgba(239, 68, 68, 0.2); }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 style="font-size: 20px; margin: 0;">CloudGrip Analytics & Management</h1>
          <a href="/admin/logout" class="logout">Logout</a>
        </div>

        <div class="grid">
          <div class="card" style="border-left: 4px solid #10b981;">
            <h3>Revenue</h3>
            <div class="value">$${totalRevenue}</div>
            <div class="subtext">$15.00 x Active Subs</div>
          </div>
          <div class="card">
            <h3>Active Subs</h3>
            <div class="value">${activeSubs}</div>
          </div>
          <div class="card">
            <h3>Total Users</h3>
            <div class="value">${totalUsers}</div>
          </div>
          <div class="card" style="border-left: 4px solid #3b82f6;">
            <h3>Website Visits</h3>
            <div class="value">${siteVisits}</div>
            <div class="subtext">Homepage loads</div>
          </div>
          <div class="card">
            <h3>Proxy Requests</h3>
            <div class="value">${proxyRequests}</div>
          </div>
        </div>

        <div class="section">
          <h3 style="margin-top: 0; color: #fff; font-size: 16px; margin-bottom: 15px;">Registered Clients & Spend Management</h3>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Current Spend / Cap</th>
                <th>Status</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${clientsTableHtml || '<tr><td colspan="4" style="padding:15px; text-align:center; color:#64748b;">No registered clients found.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h3 style="margin-top: 0; color: #94a3b8; font-size: 14px; margin-bottom: 15px;">Proxy Request Volume (Last 7 Days)</h3>
          <canvas id="trafficChart" height="70"></canvas>
        </div>

        <script>
          const ctx = document.getElementById('trafficChart').getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: ${JSON.stringify(chartLabels.length ? chartLabels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])},
              datasets: [{
                label: 'Requests',
                data: ${JSON.stringify(chartValues.length ? chartValues : [0, 0, 0, 0, 0, 0, 0])},
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
              }]
            },
            options: {
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' } }
              }
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Analytics Route Error:', err);
    res.status(500).send('Error loading analytics data.');
  }
});

app.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const user = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
  if (user.rows.length === 0) {
    return res.status(404).json({ error: 'No account found with this email address.' });
  }
  res.json({ success: true, message: 'Password recovery instructions sent to your email.' });
});

// Client Stats & Expiry Check
app.get('/client/stats', async (req, res) => {
  let clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey || clientKey === 'null' || clientKey === 'undefined') clientKey = null;
  const email = req.query.email;

  if (!clientKey && !email) return res.status(401).json({ error: 'Unauthorized' });

  let result;
  if (clientKey) {
    result = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
  }
  if ((!result || result.rows.length === 0) && email) {
    result = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
  }

  if (!result || result.rows.length === 0) return res.status(403).json({ error: 'Forbidden or Account not found' });

  const client = result.rows[0];
  const now = new Date();
  const trialExpiry = new Date(client.trial_expires_at);
  let status = client.status;

  if (now > trialExpiry && status === 'active') {
    status = 'expired';
    await pool.query("UPDATE clients SET status = 'expired' WHERE id = $1", [client.id]);
  }

  const logsResult = await pool.query('SELECT * FROM request_logs WHERE client_key = $1 ORDER BY id DESC LIMIT 10', [client.client_key || 'none']);

  res.json({
    success: true,
    currentSpendUSD: client.current_spend_usd,
    budgetCapUSD: client.budget_cap_usd || 15.00,
    trialExpiresAt: client.trial_expires_at,
    status: status,
    email: client.email,
    client_key: client.client_key,
    notice: status === 'expired' ? 'Your API gateway access has been paused until you resubscribe.' : null,
    logs: logsResult.rows
  });
});

// Update Hard Budget Cap Limit
app.post('/client/budget-cap', async (req, res) => {
  let clientKey = req.headers['x-cloudgrip-key'] || req.body.client_key;
  if (!clientKey || clientKey === 'null' || clientKey === 'undefined') clientKey = null;
  const { budgetCap, email } = req.body;

  let client;
  if (clientKey) {
    const resClient = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
    client = resClient.rows[0];
  }
  if (!client && email) {
    const resClient = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
    client = resClient.rows[0];
  }

  if (!client) return res.status(403).json({ error: 'Unauthorized or account not found.' });

  const capValue = parseFloat(budgetCap);
  if (isNaN(capValue) || capValue <= 0) {
    return res.status(400).json({ error: 'Invalid budget cap amount.' });
  }

  await pool.query('UPDATE clients SET budget_cap_usd = $1 WHERE id = $2', [capValue, client.id]);
  res.json({ success: true, message: 'Gateway budget cap updated successfully.' });
});

// Client-side endpoint to reset own spend (Refresh Cap)
app.post('/client/reset-spend', async (req, res) => {
  let clientKey = req.headers['x-cloudgrip-key'] || req.body.client_key;
  if (!clientKey || clientKey === 'null' || clientKey === 'undefined') clientKey = null;
  const email = req.body.email;

  let client;
  if (clientKey) {
    const resClient = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
    client = resClient.rows[0];
  }
  if (!client && email) {
    const resClient = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
    client = resClient.rows[0];
  }

  if (!client) return res.status(403).json({ error: 'Unauthorized or account not found.' });

  await pool.query('UPDATE clients SET current_spend_usd = 0.00 WHERE id = $1', [client.id]);
  res.json({ success: true, message: 'Spend cap refreshed successfully.' });
});

// Initialize Paystack Subscription ($15 USD converted to NGN)
app.post('/api/topup/initialize', async (req, res) => {
  let clientKey = req.headers['x-cloudgrip-key'] || req.body.client_key;
  if (!clientKey || clientKey === 'null' || clientKey === 'undefined') clientKey = null;
  const email = req.body.email || req.query.email;

  let client;
  if (clientKey) {
    const resClient = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
    client = resClient.rows[0];
  } 
  if (!client && email) {
    const resClient = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
    client = resClient.rows[0];
  }

  if (!client) return res.status(403).json({ error: 'Forbidden or Account not found.' });

  const amountUSD = 15.00;
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

// Verify Payment & Reactivate Subscription
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
        const client = clientRes.rows[0];
        const existingKey = client.client_key;
        const activeClientKey = existingKey && existingKey !== 'null' ? existingKey : `cg-${crypto.randomBytes(16).toString('hex')}`;
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await pool.query(
          'UPDATE clients SET client_key = $1, current_spend_usd = 0.00, trial_expires_at = $2, status = $3 WHERE email = $4',
          [activeClientKey, newExpiry, 'active', email]
        );

        return res.redirect(`/?payment=success&new_key=${activeClientKey}`);
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

// Registration
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
      INSERT INTO clients (client_key, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, budget_cap_usd, trial_expires_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [clientKey, email, hashedPassword, fingerprint || 'unknown', 15.00, 0.00, 15.00, trialExpiresAt, status]);

    res.json({ 
      success: true, 
      apiKey: clientKey,
      email: email,
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

  res.json({ 
    success: true, 
    apiKey: userRes.rows[0].client_key, 
    email: userRes.rows[0].email 
  });
});

// Middleware for proxy traffic strictly enforcing expired subscription pauses & budget caps
app.use(async (req, res, next) => {
  if (['/events', '/register', '/login', '/', '/terms', '/privacy', '/client/stats', '/client/budget-cap', '/client/reset-spend', '/forgot-password', '/admin/login', '/analytics', '/admin/reset-spend'].includes(req.path) || req.path.startsWith('/api/topup/')) return next();
  if (req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/images/')) return next();

  const clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey || clientKey === 'null' || clientKey === 'undefined') return res.status(401).json({ error: 'Unauthorized: Missing key' });

  const clientRes = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
  if (clientRes.rows.length === 0) return res.status(403).json({ error: 'Forbidden: Invalid or Revoked API Key' });

  const clientConfig = clientRes.rows[0];
  const now = new Date();
  const trialExpiry = new Date(clientConfig.trial_expires_at);

  if (clientConfig.status === 'expired' || now > trialExpiry) {
    if (clientConfig.status !== 'expired') {
      await pool.query("UPDATE clients SET status = 'expired' WHERE id = $1", [clientConfig.id]);
    }
    return res.status(402).json({ error: 'Payment Required: Your API gateway access has been paused due to an expired subscription. Please resubscribe to reactivate.' });
  }

  if (clientConfig.current_spend_usd >= (clientConfig.budget_cap_usd || 15.00)) {
    return res.status(402).json({ error: 'Circuit Breaker Triggered: Maximum budget cap reached. Please top up or increase your cap.' });
  }

  req.clientConfig = clientConfig;
  next();
});

app.all(/.*/, async (req, res) => {
  if (['/', '/register', '/login', '/events', '/terms', '/privacy', '/client/stats', '/client/budget-cap', '/client/reset-spend', '/forgot-password', '/admin/login', '/analytics', '/admin/reset-spend'].includes(req.path) || req.path.startsWith('/api/topup/')) return;

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
      newSpend = req.clientConfig.current_spend_usd + cost;
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

// Start server ONLY after tables are initialized to prevent race conditions
async function startServer() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        client_key TEXT UNIQUE,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        device_fingerprint TEXT,
        budget_usd REAL NOT NULL,
        current_spend_usd REAL NOT NULL,
        budget_cap_usd REAL DEFAULT 15.00,
        trial_expires_at TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS request_logs (
        id SERIAL PRIMARY KEY,
        client_key TEXT,
        method TEXT,
        endpoint TEXT,
        status_code INT,
        cost REAL,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS site_visits (
        id SERIAL PRIMARY KEY,
        visited_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[CloudGrip Engine] Connected to Supabase PostgreSQL & Tables Verified');

    app.listen(PORT, () => {
      console.log(`[CloudGrip Engine] Live on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
}

startServer();