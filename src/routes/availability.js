const express = require('express');
const router = express.Router();
const { listAvailableDoctors } = require('../services/calendarService');
const { parseHour, isValidDate, CLINIC_OPEN_HOUR, CLINIC_CLOSE_HOUR } = require('../utils/time');

// POST /api/availability
// Body: { "date": "2026-07-24", "time": "12:00" }
router.post('/availability', async (req, res) => {
  try {
    const { date, time } = req.body || {};

    if (!date || !time) {
      return res.status(400).json({
        error: 'Field "date" dan "time" wajib diisi.',
      });
    }

    if (!isValidDate(date)) {
      return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    }

    const hour = parseHour(time);

    if (hour === null || hour < CLINIC_OPEN_HOUR || hour >= CLINIC_CLOSE_HOUR) {
      return res.status(400).json({
        error: `Jam praktik hanya tersedia antara ${CLINIC_OPEN_HOUR}.00 - ${CLINIC_CLOSE_HOUR}.00.`,
      });
    }

    const availableDoctors = await listAvailableDoctors(date, hour);

    return res.json({
      date,
      time: `${String(hour).padStart(2, '0')}:00`,
      isFull: availableDoctors.length === 0,
      availableSlots: availableDoctors.length,
      availableDoctors: availableDoctors.map((d) => ({ id: d.id, name: d.name })),
    });
  } catch (err) {
    console.error('Gagal cek ketersediaan:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
      ...(process.env.NODE_ENV !== 'production' && { detail: err.message }),
    });
  }
});

module.exports = router;
