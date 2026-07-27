/**
 * Script ini dijalankan SATU KALI SAJA (one-time setup) untuk login
 * ke akun Google clinic dan mendapatkan refresh_token.
 *
 * Setelah refresh_token didapat, backend Express tidak perlu
 * login ulang lagi selamanya (kecuali refresh_token di-revoke manual).
 *
 * Cara pakai:
 *   1. Isi GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET di .env
 *   2. Jalankan: npm run oauth:login
 *   3. Buka link yang muncul di terminal, login pakai akun Google clinic
 *   4. Refresh token otomatis tersimpan ke file .env
 */

require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const PORT = process.env.OAUTH_LOGIN_PORT || 4000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error(
    '❌ GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET wajib diisi di .env sebelum menjalankan script ini.'
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', 
  prompt: 'consent', 
  scope: SCOPES,
});

console.log('\n=== Clinic Calendar - OAuth Login (One-time Setup) ===\n');
console.log('1. Buka link berikut di browser, lalu login pakai akun Google clinic:\n');
console.log(authUrl);
console.log('\n2. Setelah authorize, kamu akan diarahkan otomatis dan token akan tersimpan di sini.\n');

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end();
      return;
    }

    const { code, error } = parsedUrl.query;

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h2>Login dibatalkan atau gagal: ${error}</h2>`);
      server.close(() => process.exit(1));
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h2>Gagal: authorization code tidak ditemukan.</h2>');
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<h2>&#9989; Berhasil! Kamu boleh menutup tab ini dan kembali ke terminal.</h2>'
    );

    console.log('\n=== Berhasil mendapatkan token ===\n');
    console.log('Refresh Token:', tokens.refresh_token);

    if (!tokens.refresh_token) {
      console.warn(
        '\n⚠️  Tidak ada refresh_token yang dikembalikan (biasanya karena akun ini sudah pernah authorize sebelumnya).\n' +
          'Cabut akses lama di https://myaccount.google.com/permissions lalu jalankan ulang script ini.\n'
      );
    } else {
      saveRefreshTokenToEnv(tokens.refresh_token);
      console.log('\n✅ Refresh token otomatis ditulis ke file .env (GOOGLE_REFRESH_TOKEN).');
      console.log('✅ Backend siap dipakai, jalankan: npm start\n');
    }

    server.close(() => process.exit(0));
  } catch (err) {
    console.error('Gagal menukar authorization code dengan token:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h2>Terjadi kesalahan. Cek terminal untuk detail.</h2>');
    server.close(() => process.exit(1));
  }
});

function saveRefreshTokenToEnv(refreshToken) {
  // Karena sekarang file ini ada di root directory, .env juga ada di root (__dirname)
  const envPath = path.join(__dirname, '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
    envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN=${refreshToken}`);
  } else {
    envContent += `\nGOOGLE_REFRESH_TOKEN=${refreshToken}\n`;
  }

  fs.writeFileSync(envPath, envContent);
}

server.listen(PORT, () => {
  console.log(`Menunggu callback di ${REDIRECT_URI} ...\n`);
});
