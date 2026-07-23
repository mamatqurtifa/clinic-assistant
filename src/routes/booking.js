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

// GET /api/bookings
router.get('/bookings', async (req, res) => {
  try {
    const { date, time, doctorId } = req.query;

    if (date && !isValidDate(date)) {
      return res.status(400).json({ error: 'Format date harus YYYY-MM-DD, contoh: 2026-07-24.' });
    }

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
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

// PATCH /api/bookings/:eventId
router.patch('/bookings/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { date, time, doctorId } = req.body || {};

    // Minimal satu field harus diisi
    if (!date && !time && !doctorId) {
      return res.status(400).json({
        error: 'Minimal satu field harus diisi: date, time, atau doctorId.',
      });
    }

    // date dan time harus berpasangan jika salah satu diisi
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
    if (date && hour !== undefined) {
      const targetDoctorId = doctorId || null;
      // Jika doctorId tidak diganti, kita perlu tahu dokter saat ini dari event
      // Gunakan isDoctorAvailable hanya jika doctorId diketahui
      if (targetDoctorId) {
        const available = await isDoctorAvailable(date, hour, targetDoctorId, eventId);
        if (!available) {
          return res.status(409).json({
            error: `${doctor.name} sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.`,
            isFull: true,
          });
        }
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
    if (err?.code === 404 || err?.code === 410 || err?.status === 404 || err?.status === 410) {
      return res.status(404).json({ error: 'Booking tidak ditemukan atau sudah dibatalkan.' });
    }
    console.error('Gagal membatalkan booking:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

module.exports = router;
