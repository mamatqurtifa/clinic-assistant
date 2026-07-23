const CLINIC_OPEN_HOUR = 10;
const CLINIC_CLOSE_HOUR = 14; // slot terakhir mulai jam 13, selesai jam 14

// Menerima format waktu "10", "10:00", atau "10.00" -> kembalikan angka jam (integer)
function parseHour(time) {
  const match = String(time).match(/^(\d{1,2})/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  return Number.isNaN(hour) ? null : hour;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

module.exports = {
  CLINIC_OPEN_HOUR,
  CLINIC_CLOSE_HOUR,
  parseHour,
  isValidEmail,
  isValidDate,
};
