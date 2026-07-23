const express = require('express');
const router = express.Router();
const {
  findAvailableDoctor,
  createBookingEvent,
  getBookings,
  cancelBooking,
} = require('../services/calendarService');
const {
  parseHour,
  isValidEmail,
  isValidDate,
  CLINIC_OPEN_HOUR,
  CLINIC_CLOSE_HOUR,
} = require('../utils/time');

// GET /api/bookings
router.get('/bookings', async (req, res) => {
  try {
    const { date, time, doctorId } = req.query;

    // Validasi date jika diisi
    if (date && !isValidDate(date)) {
      return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    }

    // Validasi time jika diisi (time butuh date)
    let hour = null;
    if (time) {
      if (!date) {
        return res.status(400).json({ error: 'Query param "date" wajib diisi jika menggunakan "time".' });
      }
      hour = parseHour(time);
      if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
        return res.status(400).json({
          error: `Jam praktik hanya tersedia antara ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.`,
        });
      }
    }

    const bookings = await getBookings({ date, hour, doctorId });

    return res.json({
      total: bookings.length,
      filters: {
        date: date || null,
        time: hour !== null ? `${String(hour).padStart(2, '0')}:00` : null,
        doctorId: doctorId || null,
      },
      bookings,
    });
  } catch (err) {
    console.error('Gagal mengambil daftar booking:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// POST /api/bookings
router.post('/bookings', async (req, res) => {
  try {
    const { date, time, email } = req.body;

    if (!date || !time || !email) {
      return res.status(400).json({ error: 'Field date, time, dan email wajib diisi.' });
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

    // Cari dokter yang masih kosong di jam tsb (max 5 dokter, 1 pasien/jam/dokter)
    const doctor = await findAvailableDoctor(date, hour);

    if (!doctor) {
      return res.status(409).json({
        error: 'Semua dokter sudah penuh di jam tersebut. Silakan pilih jam lain.',
        isFull: true,
      });
    }

    const event = await createBookingEvent({
      doctor,
      date,
      hour,
      patientEmail: email,
    });

    return res.status(201).json({
      message: 'Booking berhasil dibuat.',
      doctor: doctor.name,
      date,
      time: `${String(hour).padStart(2, '0')}:00`,
      meetLink: event.hangoutLink || null,
      eventId: event.id,
      eventLink: event.htmlLink,
    });
  } catch (err) {
    console.error('Gagal membuat booking:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// DELETE /api/bookings/:eventId
router.delete('/bookings/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!eventId || eventId.trim() === '') {
      return res.status(400).json({ error: 'eventId wajib disertakan di URL.' });
    }

    await cancelBooking(eventId.trim());

    return res.json({
      message: 'Booking berhasil dibatalkan. Notifikasi pembatalan dikirim ke pasien.',
      eventId: eventId.trim(),
    });
  } catch (err) {
    // Google Calendar mengembalikan 404 / 410 jika event tidak ditemukan
    if (err?.code === 404 || err?.code === 410 || err?.status === 404 || err?.status === 410) {
      return res.status(404).json({ error: 'Booking tidak ditemukan atau sudah dibatalkan.' });
    }
    console.error('Gagal membatalkan booking:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

module.exports = router;
