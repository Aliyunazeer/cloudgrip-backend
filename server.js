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
import nodemailer from 'nodemailer';

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

// Configure Nodemailer Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cloudgrip-secure-admin-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  res.redirect('/admin/login');
}

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
  res.send(`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <title>Terms of Service — CloudGrip AI</title>
  <style>
    body { background: #000; color: #a1a1aa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 60px 24px; max-width: 800px; margin: auto; line-height: 1.6; }
    h1 { font-size: 24px; color: #fff; margin-bottom: 8px; font-weight: 600; }
    h2 { font-size: 16px; color: #fff; margin-top: 32px; margin-bottom: 12px; font-weight: 600; }
    p, li { font-size: 13.5px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p>CloudGrip is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind.</p>
</body>
</html>`);
});

app.get('/privacy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <title>Privacy Policy — CloudGrip AI</title>
  <style>
    body { background: #000; color: #a1a1aa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 60px 24px; max-width: 800px; margin: auto; line-height: 1.6; }
    h1 { font-size: 24px; color: #fff; margin-bottom: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p>All proxy telemetry and account states are securely managed and stored within your private instance.</p>
</body>
</html>`);
});

app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin Login</title>
  <style>body { background: #0b0f19; color: #fff; font-family: sans-serif; display: flex; height: 100vh; align-items: center; justify-content: center; margin: 0; }
  .card { background: #131b2e; border: 1px solid #1e293b; padding: 40px; border-radius: 8px; width: 300px; }
  input { width: 100%; box-sizing: border-box; padding: 12px; margin-bottom: 15px; background: #0b0f19; border: 1px solid #334155; color: #fff; border-radius: 4px; }
  button { width: 100%; padding: 12px; background: #10b981; border: none; color: #fff; font-weight: bold; border-radius: 4px; cursor: pointer; }</style>
  </head><body><div class="card"><h2 style="text-align:center; margin-top:0;">Admin Login</h2>
  <form action="/admin/login" method="POST"><input type="password" name="password" placeholder="Password" required autofocus /><button type="submit">Login</button></form></div></body></html>`);
});

app.post('/admin/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.password === 'admin123') {
    req.session.isAdmin = true;
    return res.redirect('/analytics');
  }
  res.send('<script>alert("Wrong password!"); window.location.href="/admin/login";</script>');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const usersCountRes = await pool.query('SELECT COUNT(*) FROM clients');
    const activeSubsRes = await pool.query("SELECT COUNT(*) FROM clients WHERE status = 'active'");
    res.send(`<!DOCTYPE html><html><head><title>Analytics</title><style>body{background:#0b0f19;color:#fff;font-family:sans-serif;padding:30px;}</style></head>
    <body><h1>CloudGrip Analytics</h1><p>Total Users: ${usersCountRes.rows[0].count} | Active: ${activeSubsRes.rows[0].count}</p>
    <a href="/admin/logout" style="color:#ef4444;">Logout</a></body></html>`);
  } catch (err) {
    res.status(500).send('Error loading analytics.');
  }
});

app.get('/client/stats', async (req, res) => {
  let clientKey = req.headers['x-cloudgrip-key'] || req.query.cloudgrip_key;
  if (!clientKey || clientKey === 'null' || clientKey === 'undefined') clientKey = null;
  const email = req.query.email;

  if (!clientKey && !email) return res.status(401).json({ error: 'Unauthorized' });

  let result;
  if (clientKey) result = await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey]);
  if ((!result || result.rows.length === 0) && email) result = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);

  if (!result || result.rows.length === 0) return res.status(403).json({ error: 'Account not found' });

  const client = result.rows[0];
  const logsResult = await pool.query('SELECT * FROM request_logs WHERE client_key = $1 ORDER BY id DESC LIMIT 10', [client.client_key || 'none']);

  res.json({
    success: true,
    currentSpendUSD: client.current_spend_usd,
    budgetCapUSD: client.budget_cap_usd || 15.00,
    trialExpiresAt: client.trial_expires_at,
    status: client.status,
    email: client.email,
    client_key: client.client_key,
    logs: logsResult.rows
  });
});

app.post('/client/budget-cap', async (req, res) => {
  let clientKey = req.headers['x-cloudgrip-key'] || req.body.client_key;
  const { budgetCap, email } = req.body;
  let client;
  if (clientKey) client = (await pool.query('SELECT * FROM clients WHERE client_key = $1', [clientKey])).rows[0];
  if (!client && email) client = (await pool.query('SELECT * FROM clients WHERE email = $1', [email])).rows[0];
  if (!client) return res.status(403).json({ error: 'Unauthorized' });

  const capValue = parseFloat(budgetCap);
  if (isNaN(capValue) || capValue <= 0) return res.status(400).json({ error: 'Invalid budget cap.' });

  await pool.query('UPDATE clients SET budget_cap_usd = $1 WHERE id = $2', [capValue, client.id]);
  res.json({ success: true, message: 'Budget cap updated.' });
});

// Registration with Real Email Dispatch via Nodemailer
app.post('/register', async (req, res) => {
  try {
    const { email, password, fingerprint } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const existingUser = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      if (!existingUser.rows[0].is_verified) {
        const otpCode = crypto.randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        await pool.query('UPDATE clients SET otp_code = $1, otp_expires_at = $2 WHERE email = $3', [otpCode, expiresAt, email]);
        
        // Dispatch real email
        await transporter.sendMail({
          from: '"CloudGrip Security" <no-reply@cloudgrip.ai>',
          to: email,
          subject: 'Your CloudGrip Verification Code',
          text: `Your new 6-digit verification code is: ${otpCode}. It expires in 10 minutes.`
        });

        return res.json({ success: false, requiresOtp: true, message: 'Unverified account. New 6-digit OTP code sent to your email.' });
      }
      return res.status(400).json({ error: 'Email already registered. Please sign in.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const clientKey = `cg-${crypto.randomBytes(16).toString('hex')}`;
    const trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await pool.query(`
      INSERT INTO clients (client_key, email, password_hash, device_fingerprint, budget_usd, current_spend_usd, budget_cap_usd, trial_expires_at, status, otp_code, otp_expires_at, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [clientKey, email, hashedPassword, fingerprint || 'unknown', 15.00, 0.00, 15.00, trialExpiresAt, 'pending_verification', otpCode, otpExpiresAt, false]);

    // Dispatch real email via Nodemailer
    await transporter.sendMail({
      from: '"CloudGrip Security" <no-reply@cloudgrip.ai>',
      to: email,
      subject: 'Your CloudGrip Verification Code',
      text: `Your 6-digit verification code is: ${otpCode}. It expires in 10 minutes.`
    });

    res.json({ 
      success: false, 
      requiresOtp: true,
      email: email,
      message: 'Verification code sent successfully to your email.'
    });
  } catch (err) {
    console.error('Registration/Email Error:', err.message);
    res.status(500).json({ error: 'Failed to send verification email. Please check server configuration.' });
  }
});

// Verify Secure OTP Route
app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const userRes = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    const user = userRes.rows[0];
    if (user.otp_code !== otp || new Date() > new Date(user.otp_expires_at)) {
      return res.status(400).json({ error: 'Invalid or expired 6-digit code.' });
    }

    await pool.query('UPDATE clients SET is_verified = TRUE, status = $1, otp_code = NULL, otp_expires_at = NULL WHERE email = $2', ['active', email]);

    res.json({ 
      success: true, 
      apiKey: user.client_key, 
      email: user.email,
      message: 'Account verified securely!' 
    });
  } catch (err) {
    console.error('OTP Verification Error:', err.message);
    res.status(500).json({ error: 'Verification failed due to a server error.' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const userRes = await pool.query('SELECT * FROM clients WHERE email = $1', [email]);

    if (userRes.rows.length === 0 || !(await bcrypt.compare(password, userRes.rows[0].password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = userRes.rows[0];
    if (!user.is_verified) {
      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await pool.query('UPDATE clients SET otp_code = $1, otp_expires_at = $2 WHERE email = $3', [otpCode, expiresAt, email]);
      
      // Dispatch real email on login attempt if unverified
      await transporter.sendMail({
        from: '"CloudGrip Security" <no-reply@cloudgrip.ai>',
        to: email,
        subject: 'Your CloudGrip Verification Code',
        text: `Your 6-digit verification code is: ${otpCode}. It expires in 10 minutes.`
      });

      return res.status(403).json({ 
        success: false, 
        requiresOtp: true, 
        email: email,
        error: 'Unverified account. New 6-digit code sent to your email.' 
      });
    }

    res.json({ success: true, apiKey: user.client_key, email: user.email });
  } catch (err) {
    console.error('Login Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error during login.' });
  }
});

// Start server ONLY after tables are initialized
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

    // Safe column migrations for existing databases
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;`);

    console.log('[CloudGrip Engine] Supabase Database & Schema Initialized Successfully');
    app.listen(PORT, () => {
      console.log(`[CloudGrip Engine] Live on port ${PORT}`);
    });
  } catch (err) {
    console.error('Database Initialization Error:', err);
    process.exit(1);
  }
}

startServer();