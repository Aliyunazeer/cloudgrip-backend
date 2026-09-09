# CloudGrip AI

Real-time API reverse proxy and automated circuit breaker for autonomous AI agents.

I built CloudGrip AI to solve a specific problem: runaway API bills caused by autonomous AI agents getting stuck in unexpected loops. CloudGrip AI sits directly between your application client and upstream LLM providers (such as Google Gemini or OpenAI). It tracks spend per request and immediately cuts off traffic at the proxy level once a predefined budget threshold is reached.

## Features

- **Inline Proxying:** Intercepts traffic with minimal overhead using Express and `http-proxy-middleware`.
- **Automated Killswitch:** Evaluates accumulated cost on every request and responds with an HTTP 429 error to drop further upstream traffic when the budget cap is hit.
- **Server-Sent Events (SSE):** Streams request logs, spend metrics, and circuit breaker status directly to the frontend in real time without polling.
- **Real-Time Dashboard:** Minimalist dark UI built with Tailwind CSS to visualize live spend, traffic counts, and system status.

## Tech Stack

- **Backend:** Node.js, Express, `http-proxy-middleware`
- **Streaming:** Server-Sent Events (SSE)
- **Frontend:** HTML5, Tailwind CSS
- **Hosting:** Render

## How It Works

1. Incoming requests hit the CloudGrip AI proxy endpoint.
2. The middleware increments internal spend tracking and evaluates the total against the hard budget cap (set to $0.50 in the current demo).
3. If spend is within limits, the proxy forwards the request to the target provider (`generativelanguage.googleapis.com`) and streams telemetry data to the dashboard.
4. If the budget cap is exceeded, the proxy blocks the request, triggers a `KILLSWITCH_TRIGGERED` event over SSE, and returns a 429 status code.

## Local Setup

### 1. Repository Setup and Installation

```bash
git clone [https://github.com/Aliyunazeer/cloudgrip-backend.git](https://github.com/Aliyunazeer/cloudgrip-backend.git)
cd cloudgrip-backend
npm install