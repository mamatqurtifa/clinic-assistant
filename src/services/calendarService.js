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

// toRFC3339('2026-07-24', 12) -> "2026-07-24T12:00:00+07:00"
function toRFC3339(date, hour) {
  return `${date}T${pad2(hour)}:00:00${TZ_OFFSET}`;
}

// Ambil semua event di slot jam tertentu (1 jam)
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

// Cari nama-nama dokter yang sudah terisi di slot jam tsb
async function getBookedDoctorNames(date, hour) {
  const events = await getEventsInSlot(date, hour);
  const titles = events.map((e) => e.summary || '');

  return doctors
    .filter((doc) => titles.some((title) => title.includes(doc.name)))
    .map((doc) => doc.name);
}

// Cari 1 dokter pertama yang masih kosong di slot jam tsb.
async function findAvailableDoctor(date, hour) {
  const bookedNames = await getBookedDoctorNames(date, hour);
  return doctors.find((doc) => !bookedNames.includes(doc.name)) || null;
}

// List semua dokter yang masih available di slot jam tsb.
async function listAvailableDoctors(date, hour) {
  const bookedNames = await getBookedDoctorNames(date, hour);
  return doctors.filter((doc) => !bookedNames.includes(doc.name));
}

// Cek apakah dokter tertentu masih available di slot jam tsb.
async function isDoctorAvailable(date, hour, doctorId, excludeEventId = null) {
  const calendar = getCalendarClient();

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

// Buat event booking baru
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
        { method: 'email', minutes: 30 },
        { method: 'popup', minutes: 15 },
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

// Reschedule booking yang sudah ada.
async function rescheduleBooking(eventId, { date, hour, doctor }) {
  const calendar = getCalendarClient();

  const patch = {};

  if (date !== undefined && hour !== undefined) {
    patch.start = { dateTime: toRFC3339(date, hour), timeZone: TIMEZONE };
    patch.end = { dateTime: toRFC3339(date, hour + 1), timeZone: TIMEZONE };
  }

  if (doctor) {
    patch.summary = `Konsultasi dengan ${doctor.name}`;
    patch.description = `Konsultasi online dengan ${doctor.name} melalui Google Meet.`;
  }

  const res = await calendar.events.patch({
    calendarId: CALENDAR_ID,
    eventId,
    requestBody: patch,
    sendUpdates: 'all',
  });

  return res.data;
}

async function getBookings({ date, hour, doctorId } = {}) {
  const calendar = getCalendarClient();

  const params = {
    calendarId: CALENDAR_ID,
    singleEvents: true,
    orderBy: 'startTime',
  };

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
    const eventDate = startDT.slice(0, 10);
    const eventHour = startDT ? new Date(startDT).getHours() : null;

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

  if (doctorId) {
    const targetDoc = doctors.find((d) => d.id === doctorId);
    if (targetDoc) {
      result = result.filter((ev) => ev.doctor?.id === doctorId);
    } else {
      result = [];
    }
  }

  return result;
}

async function cancelBooking(eventId) {
  const calendar = getCalendarClient();

  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId,
    sendUpdates: 'all',
  });

  return { success: true, eventId };
}

module.exports = {
  getEventsInSlot,
  getBookedDoctorNames,
  findAvailableDoctor,
  listAvailableDoctors,
  isDoctorAvailable,
  createBookingEvent,
  rescheduleBooking,
  getBookings,
  cancelBooking,
};
