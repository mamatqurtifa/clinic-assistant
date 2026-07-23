const express = require('express');
const router = express.Router();
const { findAvailableDoctor, createBookingEvent } = require('../services/calendarService');
const {
  parseHour,
  isValidEmail,
  isValidDate,
  CLINIC_OPEN_HOUR,
  CLINIC_CLOSE_HOUR,
} = require('../utils/time');

// POST /api/bookings
// body: { "date": "2026-07-24", "time": "12:00", "email": "pasien@example.com" }
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

module.exports = router;
