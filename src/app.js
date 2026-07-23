require('dotenv').config();
const express = require('express');

const availabilityRoute = require('./routes/availability');
const bookingRoute = require('./routes/booking');

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Clinic Calendar Proxy' });
});

app.use('/api', availabilityRoute);
app.use('/api', bookingRoute);

// Handler untuk route yang tidak ditemukan
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// Error handler umum
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Terjadi kesalahan yang tidak terduga.' });
});

module.exports = app;
