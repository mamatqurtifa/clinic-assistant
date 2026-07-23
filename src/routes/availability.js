const express = require('express');
const router = express.Router();
const { listAvailableDoctors } = require('../services/calendarService');
const { parseHour, CLINIC_OPEN_HOUR, CLINIC_CLOSE_HOUR } = require('../utils/time');

// GET /api/availability?date=2026-07-24&time=12:00
router.get('/availability', async (req, res) => {
  try {
    const { date, time } = req.query;

    if (!date || !time) {
      return res.status(400).json({
        error: 'Query parameter "date" dan "time" wajib diisi. Contoh: ?date=2026-07-24&time=12:00',
      });
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
      availableDoctors: availableDoctors.map((d) => d.name),
    });
  } catch (err) {
    console.error('Gagal cek ketersediaan:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

module.exports = router;
