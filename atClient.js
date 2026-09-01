// Wraps the Africa's Talking SDK for outbound SMS.
// If AT_USERNAME / AT_API_KEY are not set (e.g. before you've made your own
// sandbox account), this falls back to a dry-run that logs what WOULD be
// sent instead of crashing — so the rest of the app is still fully testable.

const hasCredentials = !!(process.env.AT_USERNAME && process.env.AT_API_KEY);

let sms = null;
if (hasCredentials) {
  const africastalking = require('africastalking')({
    apiKey: process.env.AT_API_KEY,
    username: process.env.AT_USERNAME, // use 'sandbox' for the free sandbox app
  });
  sms = africastalking.SMS;
}

async function sendSms(to, message) {
  if (!hasCredentials) {
    console.log(`[DRY RUN — no AT credentials set] Would send SMS to ${to}: "${message}"`);
    return { dryRun: true, to, message };
  }
  return sms.send({ to: [to], message, from: process.env.AT_SENDER_ID || undefined });
}

module.exports = { sendSms, hasCredentials };
