# CloudGrip 

A lightweight, self-hosted AI proxy gateway and dashboard built with Node.js, Express, and SQLite to manage LLM API budgets and control execution loops.

## Why CloudGrip?
Runaway agent loops and unmonitored context reloads can drain your API budget overnight. CloudGrip acts as a local circuit-breaker proxy, enforcing strict budget caps and giving you real-time visibility over your API spend and request logs.

## Features
- **Budget Circuit-Breaker:** Automatically halts requests when spending reaches your configured cap.
- **Real-Time Telemetry:** Tracks site visits, client spend, and request metadata.
- **Self-Hosted Privacy:** All logs and proxy states stay secure within your own instance.
- **Admin Analytics Dashboard:** Built-in dark-mode dashboard to monitor active users and token metrics.

## Quickstart

1. **Clone the repository:**
   git clone https://github.com/Aliyunazeer/cloudgrip-backend.git
   cd cloudgrip-backend

2. **Install dependencies:**
   npm install

3. **Configure your environment:**
   Create a .env file in the root directory and add your credentials:
   PORT=5000
   DATABASE_URL=your_supabase_postgres_connection_string
   RESEND_API_KEY=your_resend_api_key
   SESSION_SECRET=your_secure_session_secret

4. **Run the server:**
   node server.js

## License
MIT
