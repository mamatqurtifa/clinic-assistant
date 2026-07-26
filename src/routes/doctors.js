const express = require('express');
const router = express.Router();
const doctors = require('../config/doctors');

// GET /api/doctors/list
// Menampilkan seluruh daftar dokter yang ada di sistem
router.get('/doctors/list', (req, res) => {
  try {
    return res.json({
      total: doctors.length,
      doctors: doctors,
    });
  } catch (err) {
    console.error('Gagal mengambil daftar dokter:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
    });
  }
});

// POST /api/doctors/list (Untuk compatibility dengan Botika HTTP request yang mungkin menggunakan POST)
router.post('/doctors/list', (req, res) => {
  try {
    return res.json({
      total: doctors.length,
      doctors: doctors,
    });
  } catch (err) {
    console.error('Gagal mengambil daftar dokter:', err);
    return res.status(500).json({
      error: 'Terjadi kesalahan pada server.',
    });
  }
});

module.exports = router;
