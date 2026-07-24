const express = require('express');
const router = express.Router();
const {
  createBookingEvent,
  rescheduleBooking,
  getBookings,
  cancelBooking,
  isDoctorAvailable,
} = require('../services/calendarService');
const doctors = require('../config/doctors');
const {
  parseHour,
  isValidEmail,
  isValidDate,
  CLINIC_OPEN_HOUR,
  CLINIC_CLOSE_HOUR,
} = require('../utils/time');

// POST /api/bookings/list
// Query daftar booking dengan filter opsional.
// Body (semua opsional): { "date": "2026-07-24", "time": "12:00", "doctorId": "dr-01", "email": "pasien@example.com" }
router.post('/bookings/list', async (req, res) => {
  try {
    const { date, time, doctorId, email } = req.body || {};

    if (date && !isValidDate(date)) {
      return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    }

    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Format email tidak valid.' });
    }

    let hour = null;
    if (time) {
      if (!date) {
        return res.status(400).json({ error: 'Field "date" wajib diisi jika menggunakan "time".' });
      }
      hour = parseHour(time);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
        return res.status(400).json({
          error: `Jam praktik hanya tersedia antara ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.`,
        });
      }
    }

    const bookings = await getBookings({ date, hour, doctorId, email });

    return res.json({
      total: bookings.length,
      filters: {
        date: date || null,
        time: hour !== null ? `${String(hour).padStart(2, '0')}:00` : null,
        doctorId: doctorId || null,
        email: email || null,
      },
      bookings,
    });
  } catch (err) {
    console.error('Gagal mengambil daftar booking:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
      ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
    });
  }
});

// POST /api/bookings
// Buat booking baru. Pasien memilih dokter sendiri.
// Body: { "date": "2026-07-24", "time": "12:00", "email": "pasien@example.com", "doctorId": "dr-01" }
router.post('/bookings', async (req, res) => {
  try {
    const { date, time, email, doctorId } = req.body;

    if (!date || !time || !email || !doctorId) {
      return res.status(400).json({ error: 'Field date, time, email, dan doctorId wajib diisi.' });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Format email tidak valid.' });
    }

    const hour = parseHour(time);
    if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
      return res.status(400).json({
        error: `Jam praktik hanya tersedia antara ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.`,
      });
    }

    const doctor = doctors.find((d) => d.id === doctorId);
    if (!doctor) {
      return res.status(400).json({
        error: `Dokter dengan id "${doctorId}" tidak ditemukan.`,
        availableDoctors: doctors.map((d) => ({ id: d.id, name: d.name })),
      });
    }

    const available = await isDoctorAvailable(date, hour, doctorId);
    if (!available) {
      return res.status(409).json({
        error: `${doctor.name} sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.`,
        doctorId,
        isFull: true,
      });
    }

    const event = await createBookingEvent({ doctor, date, hour, patientEmail: email });

    return res.status(201).json({
      message: 'Booking berhasil dibuat.',
      eventId: event.id,
      doctor: { id: doctor.id, name: doctor.name },
      date,
      time: `${String(hour).padStart(2, '0')}:00`,
      meetLink: event.hangoutLink || null,
      eventLink: event.htmlLink,
    });
  } catch (err) {
    console.error('Gagal membuat booking:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
      ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
    });
  }
});

// POST /api/bookings/reschedule
// Reschedule booking. eventId wajib. Minimal satu field perubahan harus diisi.
// Body: { "eventId": "abc123", "date": "2026-07-25", "time": "13:00", "doctorId": "dr-02" }
// Catatan: date dan time harus berpasangan jika salah satu diisi.
router.post('/bookings/reschedule', async (req, res) => {
  try {
    const { eventId, date, time, doctorId } = req.body || {};

    if (!eventId) {
      return res.status(400).json({ error: 'Field "eventId" wajib diisi.' });
    }

    if (!date && !time && !doctorId) {
      return res.status(400).json({
        error: 'Minimal satu field harus diisi: date, time, atau doctorId.',
      });
    }

    if ((date && !time) || (!date && time)) {
      return res.status(400).json({ error: 'Field "date" dan "time" harus diisi bersamaan.' });
    }

    if (date && !isValidDate(date)) {
      return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    }

    let hour;
    if (time) {
      hour = parseHour(time);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
        return res.status(400).json({
          error: `Jam praktik hanya tersedia antara ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.`,
        });
      }
    }

    let doctor;
    if (doctorId) {
      doctor = doctors.find((d) => d.id === doctorId);
      if (!doctor) {
        return res.status(400).json({
          error: `Dokter dengan id "${doctorId}" tidak ditemukan.`,
          availableDoctors: doctors.map((d) => ({ id: d.id, name: d.name })),
        });
      }
    }

    // Cek ketersediaan dokter di slot baru (exclude event ini sendiri)
    if (date && hour !== undefined && doctorId) {
      const available = await isDoctorAvailable(date, hour, doctorId, eventId);
      if (!available) {
        return res.status(409).json({
          error: `${doctor.name} sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.`,
          isFull: true,
        });
      }
    }

    const event = await rescheduleBooking(eventId, { date, hour, doctor });

    return res.json({
      message: 'Booking berhasil direschedule.',
      eventId: event.id,
      doctor: doctor ? { id: doctor.id, name: doctor.name } : undefined,
      date: date || undefined,
      time: hour !== undefined ? `${String(hour).padStart(2, '0')}:00` : undefined,
      meetLink: event.hangoutLink || null,
      eventLink: event.htmlLink || null,
    });
  } catch (err) {
    if (err?.code === 404 || err?.code === 410 || err?.status === 404 || err?.status === 410) {
      return res.status(404).json({ error: 'Booking tidak ditemukan atau sudah dibatalkan.' });
    }
    console.error('Gagal mereschedule booking:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
      ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
    });
  }
});

// POST /api/bookings/cancel
// Batalkan booking. Google Calendar kirim notifikasi pembatalan ke semua attendee.
// Body: { "eventId": "abc123" } ATAU { "email": "pasien@example.com", "date": "2026-07-24", "time": "12:00" }
router.post('/bookings/cancel', async (req, res) => {
  try {
    const { eventId, email, date, time } = req.body || {};

    let targetEventId = eventId;

    if (!targetEventId) {
      if (!email || !date || !time) {
        return res.status(400).json({ error: 'Harap berikan eventId, atau kombinasi email, date, dan time untuk membatalkan booking.' });
      }

      if (!isValidDate(date)) {
        return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Format email tidak valid.' });
      }

      const hour = parseHour(time);
      if (hour === null) {
        return res.status(400).json({ error: 'Format time tidak valid.' });
      }

      const bookings = await getBookings({ date, hour, email });
      if (bookings.length === 0) {
        return res.status(404).json({ error: 'Booking tidak ditemukan untuk jadwal dan email tersebut.' });
      }

      // Ambil booking pertama yang cocok
      targetEventId = bookings[0].eventId;
    }

    await cancelBooking(targetEventId);

    return res.json({
      message: 'Booking berhasil dibatalkan. Notifikasi pembatalan dikirim ke pasien.',
      eventId: targetEventId,
    });
  } catch (err) {
    if (err?.code === 404 || err?.code === 410 || err?.status === 404 || err?.status === 410) {
      return res.status(404).json({ error: 'Booking tidak ditemukan atau sudah dibatalkan.' });
    }
    console.error('Gagal membatalkan booking:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
      ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
    });
  }
});

module.exports = router;
