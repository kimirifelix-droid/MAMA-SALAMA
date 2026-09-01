// Minimal persistence: a JSON file acting as the database for this MVP.
// Swap for Postgres/Mongo before any real pilot — this is fine for sandbox testing only.
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { mothers: {}, sosEvents: [], contractionSessions: {} };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function upsertMother(phoneNumber, fields) {
  const db = load();
  db.mothers[phoneNumber] = { ...(db.mothers[phoneNumber] || {}), ...fields, phoneNumber };
  save(db);
  return db.mothers[phoneNumber];
}

function getMother(phoneNumber) {
  const db = load();
  return db.mothers[phoneNumber] || null;
}

function logSos(phoneNumber, meta) {
  const db = load();
  const event = { phoneNumber, at: new Date().toISOString(), ...meta };
  db.sosEvents.push(event);
  save(db);
  return event;
}

function logContractionPing(phoneNumber, kind) {
  // kind: 'start' | 'end' — a lightweight SMS/USSD fallback for the web app's contraction timer
  const db = load();
  const sess = db.contractionSessions[phoneNumber] || [];
  sess.push({ kind, at: new Date().toISOString() });
  db.contractionSessions[phoneNumber] = sess;
  save(db);
  return sess;
}

module.exports = { load, save, upsertMother, getMother, logSos, logContractionPing };
