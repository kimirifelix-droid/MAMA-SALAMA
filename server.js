require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sendSms, hasCredentials } = require('./atClient');
const store = require('./store');

const app = express();
app.use(express.urlencoded({ extended: false })); // AT posts application/x-www-form-urlencoded
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// In-memory USSD menu state, keyed by sessionId (AT's session lasts a few minutes)
const ussdSessions = new Map();

/**
 * POST /ussd
 * Africa's Talking posts: sessionId, phoneNumber, serviceCode, text
 * `text` accumulates every digit the caller has entered this session, '*' separated.
 * We must respond starting with "CON " to keep the session open, or "END " to close it.
 */
app.post('/ussd', (req, res) => {
  const { sessionId, phoneNumber, text } = req.body;
  const input = (text || '').split('*').filter(Boolean);
  const level = input.length;
  const last = input[input.length - 1];

  res.set('Content-Type', 'text/plain');

  // Root menu
  if (level === 0) {
    return res.send(
      'CON Maternal Support Network\n' +
      '1. Contraction Timer help\n' +
      '2. Emergency / SOS\n' +
      '3. ANC reminder opt-in\n' +
      '4. Talk to a midwife'
    );
  }

  // 1. Contraction Timer help
  if (input[0] === '1') {
    if (level === 1) {
      return res.send(
        'CON Contraction Timer\n' +
        '1. Log: contraction STARTED now\n' +
        '2. Log: contraction ENDED now\n' +
        '0. Back'
      );
    }
    if (level === 2 && (last === '1' || last === '2')) {
      const kind = last === '1' ? 'start' : 'end';
      store.logContractionPing(phoneNumber, kind);
      return res.send(`END Logged: contraction ${kind}. Check the app for your full timing history.`);
    }
    if (level === 2 && last === '0') {
      return res.send(
        'CON Maternal Support Network\n' +
        '1. Contraction Timer help\n' +
        '2. Emergency / SOS\n' +
        '3. ANC reminder opt-in\n' +
        '4. Talk to a midwife'
      );
    }
    return res.send('END Sorry, that\'s not a valid option.');
  }

  // 2. Emergency / SOS
  if (input[0] === '2') {
    if (level === 1) {
      const event = store.logSos(phoneNumber, { source: 'ussd', stage: 'requested' });
      // fire-and-forget alert to the on-call midwife line
      sendSms(
        process.env.MIDWIFE_ALERT_NUMBER || '+254700000000',
        `SOS via USSD from ${phoneNumber} at ${event.at}. Call them back now.`
      );
      return res.send(
        'END Emergency logged. A midwife/dispatch contact has been notified.\n' +
        'If you can, call 999 or 112 now.'
      );
    }
  }

  // 3. ANC reminder opt-in
  if (input[0] === '3') {
    if (level === 1) {
      return res.send('CON Enter weeks pregnant (e.g. 24):');
    }
    if (level === 2) {
      const weeks = parseInt(last, 10);
      if (Number.isNaN(weeks) || weeks < 1 || weeks > 42) {
        return res.send('END That doesn\'t look like a valid week number. Please dial in again.');
      }
      store.upsertMother(phoneNumber, { weeksPregnant: weeks, ancOptIn: true, optInAt: new Date().toISOString() });
      sendSms(phoneNumber, `You're opted in to ANC reminders at ${weeks} weeks. We'll text you before each check-up.`);
      return res.send('END You are opted in to ANC reminders. You will get an SMS confirmation shortly.');
    }
  }

  // 4. Talk to a midwife
  if (input[0] === '4') {
    if (level === 1) {
      store.logSos(phoneNumber, { source: 'ussd', stage: 'midwife_request', urgent: false });
      return res.send('END Request sent. A midwife will call you back within 24 hours.\nFor emergencies use option 2 instead.');
    }
  }

  return res.send('END Sorry, that\'s not a valid option.');
});

/**
 * POST /sms/inbound
 * Africa's Talking posts: from, to, text, date, id, linkId
 * Used for two-way SMS, e.g. a mother texting STOP, or replying to a reminder.
 */
app.post('/sms/inbound', (req, res) => {
  const { from, text } = req.body;
  const body = (text || '').trim().toUpperCase();

  if (body === 'STOP') {
    store.upsertMother(from, { ancOptIn: false });
    sendSms(from, 'You have been unsubscribed from ANC reminders. Reply START to opt back in.');
  } else if (body === 'START') {
    store.upsertMother(from, { ancOptIn: true });
    sendSms(from, 'You are opted back in to ANC reminders.');
  } else if (body === 'SOS') {
    const event = store.logSos(from, { source: 'sms', stage: 'requested' });
    sendSms(
      process.env.MIDWIFE_ALERT_NUMBER || '+254700000000',
      `SOS via SMS from ${from} at ${event.at}.`
    );
    sendSms(from, 'Emergency logged. Someone will call you back. If you can, call 999 or 112 now.');
  }

  res.sendStatus(200); // AT just needs a 200; response body is ignored for inbound SMS
});

// Simple outbound trigger — e.g. call this from a cron job for scheduled ANC reminders
app.post('/sms/send-reminder', async (req, res) => {
  const { phoneNumber, message } = req.body;
  if (!phoneNumber || !message) return res.status(400).json({ error: 'phoneNumber and message required' });
  const result = await sendSms(phoneNumber, message);
  res.json({ sent: true, result });
});

app.post('/api/contraction', (req, res) => {
  const { deviceId, kind } = req.body || {};
  if (!deviceId || (kind !== 'start' && kind !== 'end')) {
    return res.status(400).json({ ok: false, error: 'deviceId and kind ("start" or "end") are required' });
  }
  const session = store.logContractionPing(deviceId, kind);
  res.json({ ok: true, session });
});

app.post('/api/sos', async (req, res) => {
  const { deviceId, lat, lng, accuracy } = req.body || {};
  if (!deviceId) return res.status(400).json({ ok: false, error: 'deviceId is required' });

  const event = store.logSos(deviceId, {
    source: 'web',
    stage: 'requested',
    location: (typeof lat === 'number' && typeof lng === 'number') ? { lat, lng, accuracy } : null,
  });

  const locText = event.location
    ? `https://maps.google.com/?q=${event.location.lat},${event.location.lng}`
    : 'location unavailable';
  const result = await sendSms(
    process.env.MIDWIFE_ALERT_NUMBER || '+254700000000',
    `SOS via web app. Device ${deviceId} at ${event.at}. Location: ${locText}`
  );

  res.json({ ok: true, event, smsResult: result });
});

app.post('/api/anc-optin', async (req, res) => {
  const { deviceId, weeksPregnant } = req.body || {};
  const weeks = parseInt(weeksPregnant, 10);
  if (!deviceId || Number.isNaN(weeks) || weeks < 1 || weeks > 42) {
    return res.status(400).json({ ok: false, error: 'deviceId and a valid weeksPregnant (1-42) are required' });
  }
  const mother = store.upsertMother(deviceId, { weeksPregnant: weeks, ancOptIn: true, optInAt: new Date().toISOString() });
  res.json({ ok: true, mother });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, atCredentialsConfigured: hasCredentials });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Mama Salama backend listening on :${PORT} (AT credentials: ${hasCredentials ? 'configured' : 'NOT set — dry-run mode'})`));
}

module.exports = app;
