const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('./server');

const DB_PATH = path.join(__dirname, 'data.json');

beforeEach(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
});

afterAll(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
});

describe('USSD root menu', () => {
  test('shows the main menu on first dial (empty text)', async () => {
    const res = await request(app)
      .post('/ussd')
      .send({ sessionId: 's1', phoneNumber: '+254712345678', serviceCode: '*384*1#', text: '' });
    expect(res.status).toBe(200);
    expect(res.text.startsWith('CON')).toBe(true);
    expect(res.text).toMatch(/Contraction Timer help/);
    expect(res.text).toMatch(/Emergency \/ SOS/);
  });
});

describe('USSD contraction timer flow', () => {
  test('logging a contraction START via USSD persists it and ends the session', async () => {
    const res = await request(app)
      .post('/ussd')
      .send({ sessionId: 's2', phoneNumber: '+254711111111', serviceCode: '*384*1#', text: '1*1' });
    expect(res.text.startsWith('END')).toBe(true);
    expect(res.text).toMatch(/contraction start/);

    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    expect(db.contractionSessions['+254711111111']).toHaveLength(1);
    expect(db.contractionSessions['+254711111111'][0].kind).toBe('start');
  });

  test('logging a contraction END via USSD persists it', async () => {
    await request(app).post('/ussd').send({ sessionId: 's3', phoneNumber: '+254711111112', text: '1*1' });
    const res = await request(app).post('/ussd').send({ sessionId: 's4', phoneNumber: '+254711111112', text: '1*2' });
    expect(res.text).toMatch(/contraction end/);

    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const kinds = db.contractionSessions['+254711111112'].map(e => e.kind);
    expect(kinds).toEqual(['start', 'end']);
  });

  test('"0. Back" returns to the root menu without ending the session', async () => {
    const res = await request(app).post('/ussd').send({ sessionId: 's5', phoneNumber: '+254711111113', text: '1*0' });
    expect(res.text.startsWith('CON')).toBe(true);
    expect(res.text).toMatch(/Maternal Support Network/);
  });
});

describe('USSD emergency SOS flow', () => {
  test('selecting Emergency logs an SOS event and ends with guidance', async () => {
    const res = await request(app)
      .post('/ussd')
      .send({ sessionId: 's6', phoneNumber: '+254722222222', text: '2' });
    expect(res.text.startsWith('END')).toBe(true);
    expect(res.text).toMatch(/Emergency logged/);
    expect(res.text).toMatch(/999 or 112/);

    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    expect(db.sosEvents).toHaveLength(1);
    expect(db.sosEvents[0].phoneNumber).toBe('+254722222222');
    expect(db.sosEvents[0].source).toBe('ussd');
  });
});

describe('USSD ANC opt-in flow', () => {
  test('valid weeks-pregnant input opts the mother in', async () => {
    await request(app).post('/ussd').send({ sessionId: 's7', phoneNumber: '+254733333333', text: '3' });
    const res = await request(app).post('/ussd').send({ sessionId: 's8', phoneNumber: '+254733333333', text: '3*24' });
    expect(res.text.startsWith('END')).toBe(true);
    expect(res.text).toMatch(/opted in/);

    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    expect(db.mothers['+254733333333'].ancOptIn).toBe(true);
    expect(db.mothers['+254733333333'].weeksPregnant).toBe(24);
  });

  test('invalid weeks input is rejected without crashing', async () => {
    const res = await request(app).post('/ussd').send({ sessionId: 's9', phoneNumber: '+254744444444', text: '3*banana' });
    expect(res.text.startsWith('END')).toBe(true);
    expect(res.text).toMatch(/valid week number/);
  });
});

describe('SMS inbound webhook', () => {
  test('STOP opts a mother out', async () => {
    await request(app).post('/ussd').send({ sessionId: 's10', phoneNumber: '+254755555555', text: '3*20' });
    const res = await request(app)
      .post('/sms/inbound')
      .send({ from: '+254755555555', to: '12345', text: 'stop', date: new Date().toISOString(), id: 'abc', linkId: 'x' });
    expect(res.status).toBe(200);

    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    expect(db.mothers['+254755555555'].ancOptIn).toBe(false);
  });

  test('SOS keyword logs an emergency event', async () => {
    await request(app)
      .post('/sms/inbound')
      .send({ from: '+254766666666', to: '12345', text: 'SOS', date: new Date().toISOString(), id: 'abc2', linkId: 'y' });

    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    expect(db.sosEvents.some(e => e.phoneNumber === '+254766666666' && e.source === 'sms')).toBe(true);
  });
});

describe('health check', () => {
  test('reports whether real AT credentials are configured', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('atCredentialsConfigured');
  });
});
