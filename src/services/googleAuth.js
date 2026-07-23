const { google } = require('googleapis');

/**
 * Membuat OAuth2 client yang sudah terisi refresh_token.
 *
 * PENTING: library googleapis akan OTOMATIS menukar refresh_token
 * menjadi access_token baru setiap kali dibutuhkan (misalnya access
 * token expired setelah 1 jam). Jadi kita tidak perlu handle refresh
 * secara manual di sini, cukup set refresh_token sekali di awal.
 */
function getOAuth2Client() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    GOOGLE_REFRESH_TOKEN,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      'Kredensial Google belum lengkap. Pastikan GOOGLE_CLIENT_ID, ' +
        'GOOGLE_CLIENT_SECRET, dan GOOGLE_REFRESH_TOKEN sudah diisi di .env. ' +
        'Jalankan "npm run oauth:login" dulu kalau GOOGLE_REFRESH_TOKEN masih kosong.'
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: GOOGLE_REFRESH_TOKEN,
  });

  return oauth2Client;
}

module.exports = { getOAuth2Client };
