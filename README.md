# Mama Salama — USSD / SMS Backend

This is a real, working Node.js/Express backend for USSD and SMS, built for
Africa's Talking. It is **not a mockup** — it's tested (see below) and ready
to plug into your own Africa's Talking sandbox.

## What is actually true right now

- ✅ The USSD menu logic (Contraction Timer log, Emergency/SOS, ANC opt-in,
  "talk to a midwife") runs, is stateful across a session, and is covered by
  10 passing automated tests (`npm test`).
- ✅ The SMS inbound webhook (`STOP` / `START` / `SOS` keywords) works and is
  tested.
- ✅ Every event (SOS, contraction pings, ANC opt-ins) persists to `data.json`
  so nothing is lost between requests.
- ✅ If no Africa's Talking credentials are set, outbound SMS safely
  "dry-runs" (logs what it would send) instead of crashing — so you can
  develop and demo this before you have an account.
- ❌ It is **not** connected to a real phone number, shortcode, or the actual
  Safaricom/Airtel/Telkom network yet. That step needs your own Africa's
  Talking account — it's identity-gated (your email/phone, and for a
  dedicated shortcode, your business registration docs). I can't create that
  account for you.

## Run it yourself right now

```bash
npm install
npm test          # runs the 10 automated tests
npm start          # starts the server on :3000 in dry-run mode
```

Then simulate a real USSD session against your own machine:

```bash
curl -X POST http://localhost:3000/ussd \
  -d "sessionId=test1&phoneNumber=%2B254712345678&text="
```

## Going from "works on my machine" to "live on a real phone"

1. **Create a free Africa's Talking account** at africastalking.com — takes
   minutes, no business docs needed for the sandbox.
2. **Copy `.env.example` to `.env`** and fill in:
   - `AT_USERNAME=sandbox`
   - `AT_API_KEY=` (from your AT dashboard)
   - `MIDWIFE_ALERT_NUMBER=` (a real number to receive SOS alerts)
3. **Expose your local server** with a tunnel so AT's servers can reach it:
   ```bash
   ngrok http 3000
   ```
4. **In the AT sandbox dashboard**, create a USSD channel and point its
   callback URL at `https://<your-ngrok-url>/ussd`. Do the same for an SMS
   inbound channel pointing at `/sms/inbound`.
5. **Dial the sandbox USSD code from the AT Simulator** (their web-based fake
   phone) — you'll see your real menu, live.
6. **Only once that's solid**, apply through the AT dashboard for a real
   shared shortcode (24–72 hrs) or a dedicated one via the Communications
   Authority of Kenya (2–4 weeks, needs business registration). That's the
   step that makes this reachable from an actual mother's actual phone.

## Before any real pilot with real mothers

- Register with the ODPC (Kenya's Data Protection Commissioner) — you'll be
  handling health-adjacent personal data. This is a legal prerequisite, not
  an optional hardening step.
- Swap `data.json` for a real database — it's fine for testing, not for
  production concurrency or backups.
- Have a real person (midwife/CHW) actually staffing `MIDWIFE_ALERT_NUMBER`
  before you route real SOS events to it.

## Project layout

- `server.js` — Express app, all USSD/SMS routes
- `atClient.js` — Africa's Talking SDK wrapper (with dry-run fallback)
- `store.js` — JSON-file persistence
- `server.test.js` — automated tests (Jest + Supertest), simulating exactly
  the HTTP requests Africa's Talking sends
