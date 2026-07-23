const { google } = require('googleapis');
const { getOAuth2Client } = require('./googleAuth');
const doctors = require('../config/doctors');

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TIMEZONE = process.env.CLINIC_TIMEZONE || 'Asia/Jakarta';
const TZ_OFFSET = process.env.CLINIC_TZ_OFFSET || '+07:00';

function getCalendarClient() {
  const auth = getOAuth2Client();
  return google.calendar({ version: 'v3', auth });
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

// Contoh: toRFC3339('2026-07-24', 12) -> "2026-07-24T12:00:00+07:00"
function toRFC3339(date, hour) {
  return `${date}T${pad2(hour)}:00:00${TZ_OFFSET}`;
}

// Ambil semua event yang sudah ada di calendar pada slot jam tertentu (1 jam)
async function getEventsInSlot(date, hour) {
  const calendar = getCalendarClient();

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: toRFC3339(date, hour),
    timeMax: toRFC3339(date, hour + 1),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return res.data.items || [];
}

// Cari nama-nama dokter yang sudah terisi di slot jam tsb,
// berdasarkan kemunculan nama dokter di title (summary) event.
async function getBookedDoctorNames(date, hour) {
  const events = await getEventsInSlot(date, hour);
  const titles = events.map((e) => e.summary || '');

  return doctors
    .filter((doc) => titles.some((title) => title.includes(doc.name)))
    .map((doc) => doc.name);
}

// Cari 1 dokter pertama yang masih kosong di slot jam tsb.
// Return null kalau semua dokter (5) sudah penuh di jam itu.

async function findAvailableDoctor(date, hour) {
  const bookedNames = await getBookedDoctorNames(date, hour);
  return doctors.find((doc) => !bookedNames.includes(doc.name)) || null;
}

// List semua dokter yang masih available di slot jam tsb.
async function listAvailableDoctors(date, hour) {
  const bookedNames = await getBookedDoctorNames(date, hour);
  return doctors.filter((doc) => !bookedNames.includes(doc.name));
}

// Buat event booking baru, Google Meet link otomatis, reminder,
// dan invite (attendee) ke email pasien supaya dapat notifikasi.

async function createBookingEvent({ doctor, date, hour, patientEmail }) {
  const calendar = getCalendarClient();
  const requestId = `clinic-${doctor.id}-${date}-${hour}-${Date.now()}`;

  const requestBody = {
    summary: `Konsultasi dengan ${doctor.name}`,
    description: `Konsultasi online dengan ${doctor.name} melalui Google Meet.`,
    start: { dateTime: toRFC3339(date, hour), timeZone: TIMEZONE },
    end: { dateTime: toRFC3339(date, hour + 1), timeZone: TIMEZONE },
    attendees: [{ email: patientEmail }],
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
  });

  return res.data;
}

module.exports = {
  getEventsInSlot,
  getBookedDoctorNames,
  findAvailableDoctor,
  listAvailableDoctors,
  createBookingEvent,
};
