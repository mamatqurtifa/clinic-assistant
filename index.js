require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const doctors = require('./doctors.json');

// ─── PORT & BASE URL (defined early — needed for OAUTH_REDIRECT_URI) ──────────
const PORT = process.env.PORT || 3000;
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const OAUTH_REDIRECT_URI = `${APP_BASE_URL}/auth/callback`;

// ─── CLINIC CONFIG & TIME UTILS ───────────────────────────────────────────────
const CLINIC_OPEN_HOUR  = 10;
const CLINIC_CLOSE_HOUR = 14;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TIMEZONE    = process.env.CLINIC_TIMEZONE    || 'Asia/Jakarta';
const TZ_OFFSET   = process.env.CLINIC_TZ_OFFSET   || '+07:00';

// Google OAuth scopes
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

function parseHour(time) {
  const match = String(time).match(/^(\d{1,2})/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  return Number.isNaN(hour) ? null : hour;
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isValidDate(date)   { return /^\d{4}-\d{2}-\d{2}$/.test(date); }
function pad2(num)            { return String(num).padStart(2, '0'); }
function toRFC3339(date, hour){ return `${date}T${pad2(hour)}:00:00${TZ_OFFSET}`; }

// ─── GOOGLE AUTH SERVICE ──────────────────────────────────────────────────────

/** Creates a base OAuth2 client (no credentials set yet). */
function getOAuth2ClientBase() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET wajib diisi di .env');
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_REDIRECT_URI);
}

/** Creates an OAuth2 client pre-loaded with a user's refresh token. */
function getOAuth2ClientWithToken(refreshToken) {
  const client = getOAuth2ClientBase();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** Generates the Google OAuth login URL. */
function generateAuthUrl() {
  return getOAuth2ClientBase().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: OAUTH_SCOPES,
  });
}

/**
 * Extracts refresh_token from (in priority order):
 *   1. req.body.refresh_token
 *   2. Authorization: Bearer <token> header
 *   3. req.query.refresh_token (for GET requests)
 */
function extractRefreshToken(req) {
  if (req.body && req.body.refresh_token) return String(req.body.refresh_token).trim();
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  if (req.query && req.query.refresh_token) return String(req.query.refresh_token).trim();
  return null;
}

/**
 * Auth middleware — all protected /api/* routes pass through this.
 * Returns 401 + login_url when token is missing or invalid.
 * Attaches req.oauth2Client when token is valid.
 */
async function requireAuth(req, res, next) {
  const refreshToken = extractRefreshToken(req);
  if (!refreshToken) {
    return res.status(401).json({ login_status: 'failed', login_url: generateAuthUrl() });
  }
  try {
    const oauth2Client = getOAuth2ClientWithToken(refreshToken);
    await oauth2Client.getAccessToken(); // throws if token is invalid or revoked
    req.oauth2Client = oauth2Client;
    next();
  } catch (err) {
    return res.status(401).json({ login_status: 'failed', login_url: generateAuthUrl() });
  }
}

// ─── CALENDAR SERVICE ─────────────────────────────────────────────────────────
// All functions now accept oauth2Client as their first argument.

function getCalendarClient(oauth2Client) {
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function getEventsInSlot(oauth2Client, date, hour) {
  const calendar = getCalendarClient(oauth2Client);
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: toRFC3339(date, hour),
    timeMax: toRFC3339(date, hour + 1),
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
}

async function getBookedDoctorNames(oauth2Client, date, hour) {
  const events = await getEventsInSlot(oauth2Client, date, hour);
  const titles = events.map((e) => e.summary || '');
  return doctors
    .filter((doc) => titles.some((title) => title.includes(doc.name)))
    .map((doc) => doc.name);
}

async function listAvailableDoctors(oauth2Client, date, hour) {
  const bookedNames = await getBookedDoctorNames(oauth2Client, date, hour);
  return doctors.filter((doc) => !bookedNames.includes(doc.name));
}

async function isDoctorAvailable(oauth2Client, date, hour, doctorId, excludeEventId = null) {
  const calendar = getCalendarClient(oauth2Client);
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: toRFC3339(date, hour),
    timeMax: toRFC3339(date, hour + 1),
    singleEvents: true,
  });
  const events = (res.data.items || []).filter((e) => e.id !== excludeEventId);
  const doctor = doctors.find((d) => d.id === doctorId);
  if (!doctor) return false;
  return !events.some((e) => (e.summary || '').includes(doctor.name));
}

async function createBookingEvent(oauth2Client, { doctor, date, hour, patientEmail }) {
  const calendar = getCalendarClient(oauth2Client);
  const requestId = `clinic-${doctor.id}-${date}-${hour}-${Date.now()}`;
  const requestBody = {
    summary: `Konsultasi dengan ${doctor.name}`,
    description: `Konsultasi online dengan ${doctor.name} melalui Google Meet.`,
    start: { dateTime: toRFC3339(date, hour), timeZone: TIMEZONE },
    end:   { dateTime: toRFC3339(date, hour + 1), timeZone: TIMEZONE },
    attendees: [
      { email: patientEmail },
      ...(doctor.email ? [{ email: doctor.email }] : []),
    ],
    conferenceData: {
      createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'email', minutes: 30 }, { method: 'popup', minutes: 15 }],
    },
  };
  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    conferenceDataVersion: 1,
    requestBody,
    sendUpdates: 'all',
  });
  return response.data;
}

async function rescheduleBooking(oauth2Client, eventId, { date, hour, doctor }) {
  const calendar = getCalendarClient(oauth2Client);
  const event = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
  const patch = {};
  if (date !== undefined && hour !== undefined) {
    patch.start = { dateTime: toRFC3339(date, hour),     timeZone: TIMEZONE };
    patch.end   = { dateTime: toRFC3339(date, hour + 1), timeZone: TIMEZONE };
  }
  if (doctor) {
    patch.summary     = `Konsultasi dengan ${doctor.name}`;
    patch.description = `Konsultasi online dengan ${doctor.name} melalui Google Meet.`;
    if (event.data.attendees) {
      const patientEmails = event.data.attendees
        .map((a) => a.email)
        .filter((e) => !doctors.some((d) => d.email === e));
      patch.attendees = [
        ...patientEmails.map((email) => ({ email })),
        ...(doctor.email ? [{ email: doctor.email }] : []),
      ];
    }
  }
  const response = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: patch,
    sendUpdates: 'all',
  });
  return response.data;
}

async function getBookings(oauth2Client, { date, hour, doctorId, email } = {}) {
  const calendar = getCalendarClient(oauth2Client);
  const params = {
    calendarId: CALENDAR_ID,
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: TIMEZONE,
  };
  if (date && hour !== undefined && hour !== null) {
    params.timeMin = toRFC3339(date, hour);
    params.timeMax = toRFC3339(date, hour + 1);
  } else if (date) {
    params.timeMin = `${date}T00:00:00${TZ_OFFSET}`;
    params.timeMax = `${date}T23:59:59${TZ_OFFSET}`;
  } else {
    params.timeMin    = new Date().toISOString();
    params.maxResults = 100;
  }
  const response = await calendar.events.list(params);
  const events = response.data.items || [];
  let result = events.map((e) => {
    const startDT    = e.start?.dateTime || '';
    const eventDate  = startDT ? startDT.slice(0, 10) : '';
    const eventHour  = startDT ? parseInt(startDT.slice(11, 13), 10) : null;
    const matchedDoc = doctors.find((doc) => (e.summary || '').includes(doc.name)) || null;
    return {
      eventId:     e.id,
      summary:     e.summary || '',
      date:        eventDate,
      time:        eventHour !== null ? `${String(eventHour).padStart(2, '0')}:00` : null,
      doctor:      matchedDoc ? { id: matchedDoc.id, name: matchedDoc.name } : null,
      patientEmail:(e.attendees || []).map((a) => a.email),
      meetLink:    e.hangoutLink || null,
      eventLink:   e.htmlLink    || null,
      status:      e.status      || 'confirmed',
    };
  });
  if (doctorId) result = result.filter((b) => b.doctor && b.doctor.id === doctorId);
  if (email)    result = result.filter((b) => b.patientEmail.includes(email));
  return result;
}

async function cancelBooking(oauth2Client, eventId) {
  const calendar = getCalendarClient(oauth2Client);
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId, sendUpdates: 'all' });
}

// ─── EXPRESS APP ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Clinic Calendar Proxy' }));

// ─── AUTH ROUTES (no auth middleware — these are the login flow) ──────────────

/**
 * GET /auth/login
 * Redirects the user's browser to the Google OAuth consent screen.
 */
app.get('/auth/login', (req, res) => {
  try {
    res.redirect(generateAuthUrl());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /auth/callback
 * Google redirects here after the user grants consent.
 * Exchanges the authorization code for tokens and redirects to /auth/token.
 */
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`
      <!DOCTYPE html><html lang="id"><body style="font-family:sans-serif;padding:40px">
        <h2>❌ Login dibatalkan</h2><p>${error}</p>
        <a href="/auth/login">Coba lagi</a>
      </body></html>`);
  }
  if (!code) {
    return res.status(400).send(`
      <!DOCTYPE html><html lang="id"><body style="font-family:sans-serif;padding:40px">
        <h2>❌ Authorization code tidak ditemukan.</h2>
        <a href="/auth/login">Coba lagi</a>
      </body></html>`);
  }

  try {
    const client = getOAuth2ClientBase();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send(`
        <!DOCTYPE html><html lang="id"><body style="font-family:sans-serif;padding:40px">
          <h2>⚠️ Refresh token tidak diterima</h2>
          <p>Kamu mungkin sudah pernah authorize sebelumnya. Cabut akses lama di
          <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a>
          kemudian <a href="/auth/login">coba lagi</a>.</p>
        </body></html>`);
    }

    res.redirect(`/auth/token?token=${encodeURIComponent(tokens.refresh_token)}`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send(`
      <!DOCTYPE html><html lang="id"><body style="font-family:sans-serif;padding:40px">
        <h2>❌ Gagal mendapatkan token</h2><p>${err.message}</p>
        <a href="/auth/login">Coba lagi</a>
      </body></html>`);
  }
});

/**
 * GET /auth/token
 * Displays the refresh token on a styled page so the user can copy it.
 * The token is passed as ?token= query param (from /auth/callback redirect).
 */
app.get('/auth/token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/auth/login');

  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clinic API — Your Access Token</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: #e2e8f0; padding: 24px;
    }
    .card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 20px; padding: 44px 40px;
      max-width: 700px; width: 100%;
      backdrop-filter: blur(24px);
      box-shadow: 0 30px 70px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(74,222,128,0.15); border: 1px solid rgba(74,222,128,0.35);
      color: #4ade80; border-radius: 50px; padding: 6px 16px;
      font-size: 13px; font-weight: 600; margin-bottom: 24px; letter-spacing: 0.3px;
    }
    h1 { font-size: 30px; font-weight: 700; margin-bottom: 10px; letter-spacing: -0.5px; }
    .sub { color: #94a3b8; margin-bottom: 32px; line-height: 1.7; font-size: 15px; }
    .label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px;
      color: #64748b; margin-bottom: 10px; font-weight: 700;
    }
    .token-box {
      background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px; padding: 18px 20px;
      font-family: 'Courier New', 'Consolas', monospace;
      font-size: 13px; word-break: break-all; color: #a5f3fc;
      line-height: 1.7; margin-bottom: 14px; cursor: text;
      transition: border-color 0.25s;
      user-select: all;
    }
    .token-box:hover { border-color: rgba(165,243,252,0.35); }
    .btn-copy {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 15px; border: none; border-radius: 12px; cursor: pointer;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; font-size: 15px; font-weight: 600;
      transition: opacity 0.2s, transform 0.15s;
      margin-bottom: 30px; letter-spacing: 0.2px;
    }
    .btn-copy:hover  { opacity: 0.88; transform: translateY(-2px); }
    .btn-copy:active { transform: translateY(0); }
    .info-box {
      background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3);
      border-radius: 12px; padding: 20px;
      font-size: 13.5px; line-height: 1.85; color: #c7d2fe; margin-bottom: 14px;
    }
    .info-box strong { color: #a5b4fc; }
    code {
      background: rgba(0,0,0,0.3); border-radius: 5px;
      padding: 2px 7px; font-family: 'Courier New', monospace; font-size: 12.5px;
    }
    .warn {
      background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3);
      border-radius: 12px; padding: 16px 20px;
      font-size: 13.5px; color: #fde68a; line-height: 1.7;
    }
    .warn a { color: #fde68a; }
    #toast {
      position: fixed; bottom: 30px; right: 30px;
      background: #4ade80; color: #052e16; padding: 13px 24px;
      border-radius: 12px; font-weight: 700; font-size: 14px;
      opacity: 0; transition: opacity 0.3s; pointer-events: none;
      box-shadow: 0 8px 24px rgba(74,222,128,0.35);
    }
    #toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">✅ Login Berhasil</div>
    <h1>Your Refresh Token</h1>
    <p class="sub">
      Salin token ini dan simpan di penyimpanan lokal kamu (misalnya variabel Botika atau <code>localStorage</code>).
      Token ini wajib disertakan di setiap request ke API klinik.
    </p>

    <div class="label">Refresh Token</div>
    <div class="token-box" id="tokenBox">${token}</div>
    <button class="btn-copy" onclick="copyToken()">📋&nbsp; Salin Token</button>

    <div class="info-box">
      <strong>Cara menyertakan token di setiap request:</strong><br><br>
      &bull;&nbsp;<strong>Body JSON (POST):</strong><br>
      &nbsp;&nbsp;&nbsp;&nbsp;<code>{ "refresh_token": "token-kamu", ... }</code><br><br>
      &bull;&nbsp;<strong>Header HTTP:</strong><br>
      &nbsp;&nbsp;&nbsp;&nbsp;<code>Authorization: Bearer token-kamu</code><br><br>
      &bull;&nbsp;<strong>Query string (GET):</strong><br>
      &nbsp;&nbsp;&nbsp;&nbsp;<code>?refresh_token=token-kamu&amp;date=2026-07-24&amp;time=12:00</code>
    </div>

    <div class="warn">
      ⚠️ <strong>Jangan bagikan token ini.</strong> Token memberikan akses penuh ke Google Calendar akunmu.
      Jika bocor, segera cabut di
      <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a>.
    </div>
  </div>

  <div id="toast">✅ Token tersalin!</div>

  <script>
    function copyToken() {
      const token = document.getElementById('tokenBox').textContent.trim();
      navigator.clipboard.writeText(token).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
      }).catch(() => {
        // Fallback for older browsers
        const el = document.getElementById('tokenBox');
        const range = document.createRange();
        range.selectNode(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand('copy');
      });
    }
  </script>
</body>
</html>`);
});

// ─── API AUTH ENDPOINTS (no requireAuth — these verify the token themselves) ──

/**
 * POST /api/auth/check
 * GET  /api/auth/check
 * Body / Header / Query: refresh_token
 *
 * Returns { login_status: "pass"|"failed", login_url: "" | "<url>" }
 */
const handleAuthCheck = async (req, res) => {
  const refreshToken = extractRefreshToken(req);
  if (!refreshToken) {
    return res.json({ login_status: 'failed', login_url: generateAuthUrl() });
  }
  try {
    const oauth2Client = getOAuth2ClientWithToken(refreshToken);
    await oauth2Client.getAccessToken();
    return res.json({ login_status: 'pass', login_url: '' });
  } catch (err) {
    return res.json({ login_status: 'failed', login_url: generateAuthUrl() });
  }
};
app.post('/api/auth/check', handleAuthCheck);
app.get('/api/auth/check',  handleAuthCheck);

/**
 * POST /api/auth/email
 * GET  /api/auth/email
 * Body / Header / Query: refresh_token
 *
 * Returns { email: "user@gmail.com", name: "User Name" }
 */
const handleAuthEmail = async (req, res) => {
  const refreshToken = extractRefreshToken(req);
  if (!refreshToken) {
    return res.status(401).json({ login_status: 'failed', login_url: generateAuthUrl() });
  }
  try {
    const oauth2Client  = getOAuth2ClientWithToken(refreshToken);
    const oauth2Service = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data }      = await oauth2Service.userinfo.get();
    return res.json({ email: data.email, name: data.name || null });
  } catch (err) {
    return res.status(401).json({ login_status: 'failed', login_url: generateAuthUrl() });
  }
};
app.post('/api/auth/email', handleAuthEmail);
app.get('/api/auth/email',  handleAuthEmail);

// ─── HELPER ───────────────────────────────────────────────────────────────────
const sanitizeInput = (val) => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (
      trimmed === '' ||
      trimmed.toLowerCase() === 'null' ||
      trimmed.toLowerCase() === 'undefined' ||
      trimmed.startsWith('{{')
    ) return null;
    return trimmed;
  }
  return val;
};

// ─── PROTECTED API ROUTES (all require valid refresh_token via requireAuth) ───

// Route: Availability
const handleAvailability = async (req, res) => {
  try {
    const { date, time } = req.body;
    if (!date || !time) return res.status(400).json({ error: 'Field "date" dan "time" wajib diisi.' });
    if (!isValidDate(date)) return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    const hour = parseHour(time);
    if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
      return res.status(400).json({ error: `Jam praktik hanya tersedia antara ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.` });
    }
    const availableDoctors = await listAvailableDoctors(req.oauth2Client, date, hour);
    return res.json({
      date,
      time: `${pad2(hour)}:00`,
      isFull: availableDoctors.length === 0,
      availableSlots: availableDoctors.length,
      availableDoctors,
    });
  } catch (err) {
    console.error('Availability Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
};
app.post('/api/availability', requireAuth, handleAvailability);
app.get('/api/availability',  requireAuth, (req, res) => { req.body = req.query; handleAvailability(req, res); });

// Route: Doctors
const handleDoctors = (req, res) => {
  try {
    return res.json({ total: doctors.length, doctors });
  } catch (err) {
    console.error('Doctors Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
};
app.get('/api/doctors/list',  requireAuth, handleDoctors);
app.post('/api/doctors/list', requireAuth, handleDoctors);

// Route: Create Booking
app.post('/api/bookings', requireAuth, async (req, res) => {
  try {
    const { date, time, email, doctorId } = req.body;
    if (!date || !time || !email || !doctorId)
      return res.status(400).json({ error: 'Field date, time, email, dan doctorId wajib diisi.' });
    if (!isValidDate(date))   return res.status(400).json({ error: 'Format date salah.' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
    const hour = parseHour(time);
    if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR)
      return res.status(400).json({ error: `Jam praktik ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.` });
    const doctor = doctors.find((d) => d.id === doctorId);
    if (!doctor) return res.status(404).json({ error: 'Dokter tidak ditemukan.' });
    const isAvail = await isDoctorAvailable(req.oauth2Client, date, hour, doctorId);
    if (!isAvail)
      return res.status(409).json({
        error: `${doctor.name} sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.`,
        doctorId,
        isFull: true,
      });
    const event = await createBookingEvent(req.oauth2Client, { doctor, date, hour, patientEmail: email });
    return res.status(201).json({
      message: 'Booking berhasil dibuat.',
      eventId: event.id,
      doctor,
      date,
      time: `${pad2(hour)}:00`,
      meetLink:  event.hangoutLink,
      eventLink: event.htmlLink,
    });
  } catch (err) {
    console.error('Create Booking Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// Route: Reschedule Booking
app.post('/api/bookings/reschedule', requireAuth, async (req, res) => {
  try {
    const { eventId, date, time, doctorId } = req.body;
    if (!eventId) return res.status(400).json({ error: 'Field "eventId" wajib diisi.' });
    if (!date && !time && !doctorId)
      return res.status(400).json({ error: 'Minimal kirim salah satu: date+time atau doctorId.' });
    if ((date && !time) || (!date && time))
      return res.status(400).json({ error: 'Field "date" dan "time" harus dikirim bersamaan.' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'Format date salah.' });
    let hour = undefined;
    if (time) {
      hour = parseHour(time);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR)
        return res.status(400).json({ error: 'Jam praktik tidak valid.' });
    }
    let targetDoctor = undefined;
    if (doctorId) {
      targetDoctor = doctors.find((d) => d.id === doctorId);
      if (!targetDoctor) return res.status(404).json({ error: 'Dokter tidak ditemukan.' });
    }
    if (date && hour !== undefined && targetDoctor) {
      const isAvail = await isDoctorAvailable(req.oauth2Client, date, hour, targetDoctor.id, eventId);
      if (!isAvail) return res.status(409).json({ error: 'Dokter sudah penuh.', doctorId, isFull: true });
    }
    const event     = await rescheduleBooking(req.oauth2Client, eventId, { date, hour, doctor: targetDoctor });
    const eventDate = event.start.dateTime.slice(0, 10);
    const eventHour = parseInt(event.start.dateTime.slice(11, 13), 10);
    const docName   = doctors.find((d) => event.summary.includes(d.name));
    return res.json({
      message:   'Booking berhasil direschedule.',
      eventId:   event.id,
      doctor:    docName,
      date:      eventDate,
      time:      `${pad2(eventHour)}:00`,
      meetLink:  event.hangoutLink,
      eventLink: event.htmlLink,
    });
  } catch (err) {
    console.error('Reschedule Error:', err);
    return res.status(500).json({ error: 'Gagal reschedule.' });
  }
});

// Route: List Bookings
app.post('/api/bookings/list', requireAuth, async (req, res) => {
  try {
    const { date, time, doctorId, email } = req.body || {};
    const cleanDate     = sanitizeInput(date);
    const cleanTime     = sanitizeInput(time);
    const cleanEmail    = sanitizeInput(email);
    const cleanDoctorId = sanitizeInput(doctorId);
    if (cleanDate  && !isValidDate(cleanDate))   return res.status(400).json({ error: 'Format date salah.' });
    if (cleanEmail && !isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Format email tidak valid.' });
    let hour = null;
    if (cleanTime) {
      if (!cleanDate) return res.status(400).json({ error: 'Field "date" wajib diisi jika menggunakan "time".' });
      hour = parseHour(cleanTime);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
        return res.status(200).json({
          message: 'Jam praktik hanya tersedia antara 10.00 - 14.00.',
          total: 0,
          filters: { date: cleanDate, time: cleanTime, doctorId: cleanDoctorId, email: cleanEmail },
          bookings: [],
        });
      }
    }

    const bookings = await getBookings(req.oauth2Client, {
      date: cleanDate, hour, doctorId: cleanDoctorId, email: cleanEmail,
    });

    // Re-fetch without email/doctorId filter to get accurate doctorStatus
    let allBookingsForDate = bookings;
    if (cleanEmail || cleanDoctorId) {
      allBookingsForDate = await getBookings(req.oauth2Client, { date: cleanDate, hour });
    }

    const doctorStatus = doctors.map((doc) => {
      const isBooked = allBookingsForDate.some((b) => b.doctor && b.doctor.id === doc.id);
      return { id: doc.id, name: doc.name, status: isBooked ? 'booked' : 'free' };
    });

    return res.json({
      total: bookings.length,
      filters: {
        date: cleanDate,
        time: hour !== null ? `${pad2(hour)}:00` : null,
        doctorId: cleanDoctorId,
        email: cleanEmail,
      },
      doctorStatus,
      bookings,
    });
  } catch (err) {
    console.error('List Bookings Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// Route: Cancel Booking
app.post('/api/bookings/cancel', requireAuth, async (req, res) => {
  try {
    const { eventId, eventIds } = req.body;
    if (!eventId && (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0)) {
      return res.status(400).json({ error: 'Field "eventId" (string) atau "eventIds" (array) wajib diisi.' });
    }
    const idsToDelete = eventIds && eventIds.length > 0 ? eventIds : [eventId];
    const deletedIds  = [];
    const failedIds   = [];

    for (const id of idsToDelete) {
      if (!id) continue;
      try {
        await cancelBooking(req.oauth2Client, id);
        deletedIds.push(id);
      } catch (e) {
        console.error(`Gagal menghapus eventId ${id}:`, e.message);
        failedIds.push(id);
      }
    }

    return res.json({
      message:      `Berhasil membatalkan ${deletedIds.length} booking.`,
      deletedCount:  deletedIds.length,
      deletedIds,
      failedCount:   failedIds.length,
      failedIds,
    });
  } catch (err) {
    console.error('Cancel Booking Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan saat membatalkan booking.' });
  }
});

// ─── FALLBACK HANDLERS ────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan yang tidak terduga.' });
});

app.listen(PORT, () => console.log(`[Proxy Server] API berjalan di http://localhost:${PORT}`));

module.exports = app;
