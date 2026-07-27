# Setup Chatbot Clinic Assistant

Ini adalah panduan instalasi untuk sistem **Chatbot Clinic Assistant** yang akan mengotomatisasi operasional klinik kamu langsung ke Google Calendar.

## Fitur Utama Chatbot:
- **Lihat Daftar Dokter**: Menampilkan daftar dokter yang berpraktik di klinik.
- **Cek Ketersediaan Jadwal**: Mengecek slot kosong seorang dokter di tanggal dan jam tertentu (hanya jam 10.00-14.00).
- **Reservasi Jadwal Baru (Booking)**: Pasien bisa langsung memesan slot konsultasi. 
- **Ubah Jadwal (Reschedule)**: Memindahkan tanggal, jam konsultasi, atau mengganti dokter.
- **Cek Riwayat Jadwal**: Mencari daftar jadwal yang sudah pernah dipesan oleh pasien tertentu atau dokter tertentu.
- **Batalkan Reservasi**: Membatalkan jadwal yang sudah dibuat.
- **Email Notifikasi & Reminder Otomatis**: Setiap reservasi, perubahan jadwal, atau pembatalan akan otomatis mengirimkan undangan Google Meet dan email pengingat (30 & 15 menit sebelum) ke email pasien maupun email dokter yang bersangkutan.

Ikuti panduan langkah demi langkah di bawah ini untuk menyiapkannya. Panduan ini dibuat khusus agar sangat mudah diikuti, walau tanpa latar belakang teknis (coding) sama sekali!

---

### 1. Siapkan File di GitHub

Vercel membutuhkan repositori GitHub untuk di-deploy. Anda harus membuat repositori milik Anda sendiri yang berisi 3 file utama.

1. Buka [github.com](https://github.com) dan buat repository baru (misal: `clinic-assistant-backend`).
2. Di dalam repository tersebut, buat 3 file baru persis dengan nama di bawah, dan *copy-paste* kode ke masing-masing file:

**1. package.json**
```json
{
  "name": "clinic-calendar-proxy",
  "version": "1.0.0",
  "description": "Proxy backend Express.js untuk booking konsultasi dokter via Google Calendar API",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "googleapis": "^140.0.1"
  }
}
```

**2. doctors.json**
```json
[
  {
    "id": "dr-01",
    "name": "dr. Andi Pratama, M.Ked",
    "email": "dr.andi.clinic@yopmail.com"
  },
  {
    "id": "dr-02",
    "name": "dr. Siti Nurhaliza, M.Ked",
    "email": "dr.siti.clinic@yopmail.com"
  },
  {
    "id": "dr-03",
    "name": "dr. Budi Santoso, M.Ked",
    "email": "dr.budi.clinic@yopmail.com"
  },
  {
    "id": "dr-04",
    "name": "dr. Rina Wijaya, M.Ked",
    "email": "dr.rina.clinic@yopmail.com"
  },
  {
    "id": "dr-05",
    "name": "dr. Hendra Kusuma, M.Ked",
    "email": "dr.hendra.clinic@yopmail.com"
  }
]
```
*(Ubah alamat email dummy di atas dengan alamat email asli para dokter)*

**3. index.js**
```javascript
require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const doctors = require('./doctors.json');

// ==========================================
// CONFIG & TIME UTILS
// ==========================================
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

// ==========================================
// GOOGLE AUTH SERVICE
// ==========================================
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

// ==========================================
// CALENDAR SERVICE
// ==========================================
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

// ==========================================
// EXPRESS APP & ROUTES
// ==========================================
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ status: 'ok', service: 'Clinic Calendar Proxy' }));

const sanitizeInput = (val) => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined' || trimmed.startsWith('{{')) return null;
    return trimmed;
  }
  return val;
};

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
    return res.status(500).json({ error: 'Terjadi kesalahan.' });
  }
};
app.post('/api/availability', handleAvailability);
app.get('/api/availability', (req, res) => { req.body = req.query; handleAvailability(req, res); });

const handleDoctors = (req, res) => {
  try { return res.json({ total: doctors.length, doctors }); } catch (err) {
    console.error('Doctors Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan.' });
  }
};
app.get('/api/doctors/list', handleDoctors);
app.post('/api/doctors/list', handleDoctors);

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
    if (!isAvail) return res.status(409).json({ error: `${doctor.name} sudah penuh.`, doctorId, isFull: true });
    const event = await createBookingEvent({ doctor, date, hour, patientEmail: email });
    return res.status(201).json({ message: 'Booking berhasil dibuat.', eventId: event.id, doctor, date, time: `${String(hour).padStart(2, '0')}:00`, meetLink: event.hangoutLink, eventLink: event.htmlLink });
  } catch (err) {
    console.error('Create Booking Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan.' });
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
    const docName = doctors.find((d) => event.summary.includes(d.name));
    return res.json({ message: 'Booking berhasil direschedule.', eventId: event.id, doctor: docName, date: event.start.dateTime.slice(0, 10), time: `${String(parseInt(event.start.dateTime.slice(11, 13), 10)).padStart(2, '0')}:00`, meetLink: event.hangoutLink, eventLink: event.htmlLink });
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
    return res.json({ total: bookings.length, filters: { date: cleanDate, time: hour !== null ? `${String(hour).padStart(2, '0')}:00` : null, doctorId: cleanDoctorId, email: cleanEmail }, bookings });
  } catch (err) {
    console.error('List Bookings Error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan.' });
  }
});

app.post('/api/bookings/cancel', async (req, res) => {
  try {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: 'Field "eventId" wajib diisi.' });
    await cancelBooking(eventId);
    return res.json({ message: 'Booking berhasil dibatalkan.', eventId });
  } catch (err) {
    console.error('Cancel Booking Error:', err);
    return res.status(404).json({ error: 'Booking tidak ditemukan atau sudah dibatalkan.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Terjadi kesalahan.' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API berjalan di http://localhost:${PORT}`));

module.exports = app;
```

---

### 2. Buat Project di Google Cloud Console

Untuk menggunakan Google Calendar secara gratis, kita perlu membuat kunci API dari Google:

1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Buat Project baru (misal: `Clinic Assistant`).
3. Buka menu **APIs & Services** > **Library**.
4. Cari **Google Calendar API** lalu klik **Enable**.

---

### 3. Konfigurasi OAuth Consent Screen

Ini adalah halaman persetujuan Google yang akan muncul saat Anda memberikan akses:

1. Ke menu **APIs & Services** > **OAuth consent screen**.
2. Pilih **External** > klik **Create**.
3. Isi informasi wajib:
   - **App name**: (bebas, misal: Clinic Bot)
   - **User support email**: (email Anda)
   - **Developer contact info**: (email Anda)
4. Klik **Save and Continue** sampai selesai (tidak perlu isi scope spesifik).
5. Pada halaman Audience / Ringkasan, klik **Publish App** (agar statusnya menjadi *In production* dan tidak *expired*).

---

### 4. Buat OAuth Client ID

Ini adalah langkah untuk mendapatkan `Client ID` dan `Client Secret` milik Anda:

1. Ke menu **APIs & Services** > **Credentials**.
2. Klik **Create Credentials** > **OAuth client ID**.
3. Pilih **Application type**: **Web application**.
4. Beri nama (misal: `Proxy`).
5. Pada bagian **Authorized redirect URIs**, klik **Add URI**.
6. Masukkan URL dari **Google OAuth 2.0 Playground**:
   ```
   https://developers.google.com/oauthplayground
   ```
7. Klik **Create**. Anda akan mendapatkan **Client ID** dan **Client secret**. Catat dan simpan keduanya!

---

### 5. Dapatkan Refresh Token via Google OAuth Playground

Kita akan menggunakan Google OAuth Playground untuk mengizinkan aplikasi membaca kalender klinik kita dan mendapatkan `refresh_token`.

1. Buka [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Klik ikon gir (Settings) di pojok kanan atas.
3. Centang **"Use your own OAuth credentials"**.
4. Masukkan **Client ID** dan **Client Secret** yang didapatkan dari langkah 4.
5. Tutup menu settings.
6. Pada bagian **Step 1**, cari dan pilih API: `Google Calendar API v3` -> `https://www.googleapis.com/auth/calendar`.
7. Klik **Authorize APIs**. (Login menggunakan akun Google klinik/dokter yang kalendernya ingin digunakan).
8. Setelah di-redirect kembali ke Playground, pada **Step 2**, klik **Exchange authorization code for tokens**.
9. Anda akan mendapatkan **Refresh token**. Simpan tulisan ini!

---

### 6. Siapkan Vercel & Deploy

3 file kita di Github tadi sekarang sudah bisa kita online-kan di Vercel:

1. Buka [vercel.com](https://vercel.com) dan **login** menggunakan GitHub Anda.
2. Dari dashboard Vercel, klik **Add New Project**.
3. Cari repository GitHub `clinic-assistant-backend` yang dibuat pada Langkah 1, lalu klik **Import**.
4. Di bagian pengisian data, **jangan klik Deploy dulu**, cari bagian **Environment Variables**.
5. Masukkan 4 variabel ini satu per satu (masukkan Name lalu Value, dan klik Add):

   | Name | Value | Keterangan |
   |------|-------|------------|
   | `GOOGLE_CLIENT_ID` | `(Masukkan dari Langkah 4)` | Dari Google Cloud Console |
   | `GOOGLE_CLIENT_SECRET` | `(Masukkan dari Langkah 4)` | Dari Google Cloud Console |
   | `GOOGLE_REFRESH_TOKEN` | `(Masukkan dari Langkah 5)` | Dari Google Playground |
   | `GOOGLE_CALENDAR_ID` | `primary` | Pakai kalender utama email klinik |

6. Setelah 4 variabel tersebut masuk, barulah klik **Deploy**.
7. Setelah selesai, Vercel akan memberikan Anda URL aktif (misal: `https://clinic-assistant-backend.vercel.app`).

**Selesai!** Endpoint Anda sekarang siap digunakan di chatbot atau *workflow* pada `https://[url-vercel-anda]/api/bookings` dan lain-lain. Seluruh dokumentasi teknis API dapat dilihat di file `API.md` jika Anda menyertakannya.
