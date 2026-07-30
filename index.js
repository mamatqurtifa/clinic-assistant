require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const doctors = require('./doctors.json');

// CONFIG & TIME UTILS
const CLINIC_OPEN_HOUR = 10;
const CLINIC_CLOSE_HOUR = 14; 
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TIMEZONE = process.env.CLINIC_TIMEZONE || 'Asia/Jakarta';
const TZ_OFFSET = process.env.CLINIC_TZ_OFFSET || '+07:00';

function parseHour(time) {
  const match = String(time).match(/^(\d{1,2})/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  return Number.isNaN(hour) ? null : hour;
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isValidDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date); }
function pad2(num) { return String(num).padStart(2, '0'); }
function toRFC3339(date, hour) { return `${date}T${pad2(hour)}:00:00${TZ_OFFSET}`; }

// GOOGLE AUTH SERVICE
function getOAuth2Client() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Kredensial Google belum lengkap. Pastikan env terisi.');
  }
  const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return oauth2Client;
}
function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getOAuth2Client() });
}

// CALENDAR SERVICE
async function getEventsInSlot(date, hour) {
  const calendar = getCalendarClient();
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID, timeMin: toRFC3339(date, hour), timeMax: toRFC3339(date, hour + 1), singleEvents: true, orderBy: 'startTime'
  });
  return res.data.items || [];
}
async function getBookedDoctorNames(date, hour) {
  const events = await getEventsInSlot(date, hour);
  const titles = events.map((e) => e.summary || '');
  return doctors.filter((doc) => titles.some((title) => title.includes(doc.name))).map((doc) => doc.name);
}
async function findAvailableDoctor(date, hour) {
  const bookedNames = await getBookedDoctorNames(date, hour);
  return doctors.find((doc) => !bookedNames.includes(doc.name)) || null;
}
async function listAvailableDoctors(date, hour) {
  const bookedNames = await getBookedDoctorNames(date, hour);
  return doctors.filter((doc) => !bookedNames.includes(doc.name));
}
async function isDoctorAvailable(date, hour, doctorId, excludeEventId = null) {
  const calendar = getCalendarClient();
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID, timeMin: toRFC3339(date, hour), timeMax: toRFC3339(date, hour + 1), singleEvents: true
  });
  const events = (res.data.items || []).filter((e) => e.id !== excludeEventId);
  const doctor = doctors.find((d) => d.id === doctorId);
  if (!doctor) return false;
  return !events.some((e) => (e.summary || '').includes(doctor.name));
}
async function createBookingEvent({ doctor, date, hour, patientEmail }) {
  const calendar = getCalendarClient();
  const requestId = `clinic-${doctor.id}-${date}-${hour}-${Date.now()}`;
  const requestBody = {
    summary: `Konsultasi dengan ${doctor.name}`,
    description: `Konsultasi online dengan ${doctor.name} melalui Google Meet.`,
    start: { dateTime: toRFC3339(date, hour), timeZone: TIMEZONE },
    end: { dateTime: toRFC3339(date, hour + 1), timeZone: TIMEZONE },
    attendees: [
      { email: patientEmail },
      ...(doctor.email ? [{ email: doctor.email }] : [])
    ],
    conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 30 }, { method: 'popup', minutes: 15 }] }
  };
  const res = await calendar.events.insert({ calendarId: CALENDAR_ID, conferenceDataVersion: 1, requestBody, sendUpdates: 'all' });
  return res.data;
}
async function rescheduleBooking(eventId, { date, hour, doctor }) {
  const calendar = getCalendarClient();
  const event = await calendar.events.get({ calendarId: CALENDAR_ID, eventId });
  const patch = {};
  if (date !== undefined && hour !== undefined) {
    patch.start = { dateTime: toRFC3339(date, hour), timeZone: TIMEZONE };
    patch.end = { dateTime: toRFC3339(date, hour + 1), timeZone: TIMEZONE };
  }
  if (doctor) {
    patch.summary = `Konsultasi dengan ${doctor.name}`;
    patch.description = `Konsultasi online dengan ${doctor.name} melalui Google Meet.`;
    
    // Pertahankan email pasien, tapi ganti email dokter lama dengan dokter baru
    if (event.data.attendees) {
      const patientEmails = event.data.attendees
        .map(a => a.email)
        .filter(e => !doctors.some(d => d.email === e));
        
      patch.attendees = [
        ...patientEmails.map(email => ({ email })),
        ...(doctor.email ? [{ email: doctor.email }] : [])
      ];
    }
  }
  const res = await calendar.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: patch, sendUpdates: 'all' });
  return res.data;
}
async function getBookings({ date, hour, doctorId, email } = {}) {
  const calendar = getCalendarClient();
  const params = { calendarId: CALENDAR_ID, singleEvents: true, orderBy: 'startTime', timeZone: TIMEZONE };
  if (date && hour !== undefined && hour !== null) {
    params.timeMin = toRFC3339(date, hour);
    params.timeMax = toRFC3339(date, hour + 1);
  } else if (date) {
    params.timeMin = `${date}T00:00:00${TZ_OFFSET}`;
    params.timeMax = `${date}T23:59:59${TZ_OFFSET}`;
  } else {
    params.timeMin = new Date().toISOString();
    params.maxResults = 100;
  }
  const res = await calendar.events.list(params);
  const events = res.data.items || [];
  let result = events.map((e) => {
    const startDT = e.start?.dateTime || '';
    const eventDate = startDT ? startDT.slice(0, 10) : '';
    const eventHour = startDT ? parseInt(startDT.slice(11, 13), 10) : null;
    const matchedDoctor = doctors.find((doc) => (e.summary || '').includes(doc.name)) || null;
    return {
      eventId: e.id,
      summary: e.summary || '',
      date: eventDate,
      time: eventHour !== null ? `${String(eventHour).padStart(2, '0')}:00` : null,
      doctor: matchedDoctor ? { id: matchedDoctor.id, name: matchedDoctor.name } : null,
      patientEmail: (e.attendees || []).map((a) => a.email),
      meetLink: e.hangoutLink || null,
      eventLink: e.htmlLink || null,
      status: e.status || 'confirmed',
    };
  });
  if (doctorId) result = result.filter((b) => b.doctor && b.doctor.id === doctorId);
  if (email) result = result.filter((b) => b.patientEmail.includes(email));
  return result;
}
async function cancelBooking(eventId) {
  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId: CALENDAR_ID, eventId, sendUpdates: 'all' });
}

// EXPRESS APP & ROUTES
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Clinic Calendar Proxy' }));

// Helper sanitize input
const sanitizeInput = (val) => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined' || trimmed.startsWith('{{')) return null;
    return trimmed;
  }
  return val;
};

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
    const availableDoctors = await listAvailableDoctors(date, hour);
    return res.json({
      date, time: `${String(hour).padStart(2, '0')}:00`, isFull: availableDoctors.length === 0, availableSlots: availableDoctors.length, availableDoctors
    });
  } catch (err) {
    console.error('Availability Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
};
app.post('/api/availability', handleAvailability);
app.get('/api/availability', (req, res) => { req.body = req.query; handleAvailability(req, res); });

// Route: Doctors
const handleDoctors = (req, res) => {
  try { return res.json({ total: doctors.length, doctors }); } catch (err) {
    console.error('Doctors Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
};
app.get('/api/doctors/list', handleDoctors);
app.post('/api/doctors/list', handleDoctors);

// Route: Bookings
app.post('/api/bookings', async (req, res) => {
  try {
    const { date, time, email, doctorId } = req.body;
    if (!date || !time || !email || !doctorId) return res.status(400).json({ error: 'Field date, time, email, dan doctorId wajib diisi.' });
    if (!isValidDate(date)) return res.status(400).json({ error: 'Format date salah.' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Format email tidak valid.' });
    const hour = parseHour(time);
    if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) return res.status(400).json({ error: `Jam praktik ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.` });
    const doctor = doctors.find((d) => d.id === doctorId);
    if (!doctor) return res.status(404).json({ error: 'Dokter tidak ditemukan.' });
    const isAvail = await isDoctorAvailable(date, hour, doctorId);
    if (!isAvail) return res.status(409).json({ error: `${doctor.name} sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.`, doctorId, isFull: true });
    const event = await createBookingEvent({ doctor, date, hour, patientEmail: email });
    return res.status(201).json({
      message: 'Booking berhasil dibuat.', eventId: event.id, doctor, date, time: `${String(hour).padStart(2, '0')}:00`, meetLink: event.hangoutLink, eventLink: event.htmlLink
    });
  } catch (err) {
    console.error('Create Booking Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.post('/api/bookings/reschedule', async (req, res) => {
  try {
    const { eventId, date, time, doctorId } = req.body;
    if (!eventId) return res.status(400).json({ error: 'Field "eventId" wajib diisi.' });
    if (!date && !time && !doctorId) return res.status(400).json({ error: 'Minimal kirim salah satu: date+time atau doctorId.' });
    if ((date && !time) || (!date && time)) return res.status(400).json({ error: 'Field "date" dan "time" harus dikirim bersamaan.' });
    if (date && !isValidDate(date)) return res.status(400).json({ error: 'Format date salah.' });
    let hour = undefined;
    if (time) {
      hour = parseHour(time);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) return res.status(400).json({ error: 'Jam praktik tidak valid.' });
    }
    let targetDoctor = undefined;
    if (doctorId) {
      targetDoctor = doctors.find((d) => d.id === doctorId);
      if (!targetDoctor) return res.status(404).json({ error: 'Dokter tidak ditemukan.' });
    }
    if (date && hour !== undefined && targetDoctor) {
      const isAvail = await isDoctorAvailable(date, hour, targetDoctor.id, eventId);
      if (!isAvail) return res.status(409).json({ error: 'Dokter sudah penuh.', doctorId, isFull: true });
    }
    const event = await rescheduleBooking(eventId, { date, hour, doctor: targetDoctor });
    const eventDate = event.start.dateTime.slice(0, 10);
    const eventHour = parseInt(event.start.dateTime.slice(11, 13), 10);
    const docName = doctors.find((d) => event.summary.includes(d.name));
    return res.json({
      message: 'Booking berhasil direschedule.', eventId: event.id, doctor: docName, date: eventDate, time: `${String(eventHour).padStart(2, '0')}:00`, meetLink: event.hangoutLink, eventLink: event.htmlLink
    });
  } catch (err) {
    console.error('Reschedule Error:', err);
    return res.status(500).json({ error: 'Gagal reschedule.' });
  }
});

app.post('/api/bookings/list', async (req, res) => {
  try {
    const { date, time, doctorId, email } = req.body || {};
    const cleanDate = sanitizeInput(date);
    const cleanTime = sanitizeInput(time);
    const cleanEmail = sanitizeInput(email);
    const cleanDoctorId = sanitizeInput(doctorId);
    if (cleanDate && !isValidDate(cleanDate)) return res.status(400).json({ error: 'Format date salah.' });
    if (cleanEmail && !isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Format email tidak valid.' });
    let hour = null;
    if (cleanTime) {
      if (!cleanDate) return res.status(400).json({ error: 'Field "date" wajib diisi jika menggunakan "time".' });
      hour = parseHour(cleanTime);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
        return res.status(200).json({ message: 'Jam praktik hanya tersedia antara 10.00 - 14.00.', total: 0, filters: { date: cleanDate, time: cleanTime, doctorId: cleanDoctorId, email: cleanEmail }, bookings: [] });
      }
    }
    
    const bookings = await getBookings({ date: cleanDate, hour, doctorId: cleanDoctorId, email: cleanEmail });
    
    let allBookingsForDate = bookings;
    if (cleanEmail || cleanDoctorId) {
      // Fetch ulang tanpa filter email & doctorId untuk mendapatkan status dokter yang sebenarnya
      allBookingsForDate = await getBookings({ date: cleanDate, hour });
    }

    const doctorStatus = doctors.map(doc => {
      const isBooked = allBookingsForDate.some(b => b.doctor && b.doctor.id === doc.id);
      return {
        id: doc.id,
        name: doc.name,
        status: isBooked ? 'booked' : 'free'
      };
    });

    return res.json({
      total: bookings.length, 
      filters: { date: cleanDate, time: hour !== null ? `${String(hour).padStart(2, '0')}:00` : null, doctorId: cleanDoctorId, email: cleanEmail }, 
      doctorStatus,
      bookings
    });
  } catch (err) {
    console.error('List Bookings Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

app.post('/api/bookings/cancel', async (req, res) => {
  try {
    const { eventId, eventIds } = req.body;
    if (!eventId && (!eventIds || !Array.isArray(eventIds) || eventIds.length === 0)) {
      return res.status(400).json({ error: 'Field "eventId" (string) atau "eventIds" (array) wajib diisi.' });
    }
    
    const idsToDelete = eventIds && eventIds.length > 0 ? eventIds : [eventId];
    const deletedIds = [];
    const failedIds = [];
    
    for (const id of idsToDelete) {
      if (!id) continue;
      try {
        await cancelBooking(id);
        deletedIds.push(id);
      } catch (e) {
        console.error(`Gagal menghapus eventId ${id}:`, e.message);
        failedIds.push(id);
      }
    }
    
    return res.json({ 
      message: `Berhasil membatalkan ${deletedIds.length} booking.`,
      deletedCount: deletedIds.length,
      deletedIds,
      failedCount: failedIds.length,
      failedIds
    });
  } catch (err) {
    console.error('Cancel Booking Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan saat membatalkan booking.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Terjadi kesalahan yang tidak terduga.' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Proxy Server] API berjalan di http://localhost:${PORT}`));

module.exports = app;
