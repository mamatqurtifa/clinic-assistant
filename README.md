# Clinic Calendar Proxy

Backend Express.js sederhana yang jadi **proxy** ke Google Calendar API. Project lain cukup panggil endpoint HTTP biasa di sini — semua urusan OAuth2 & refresh token ditangani otomatis di backend ini.

## Fitur

- Cek ketersediaan slot dokter per jam (`GET /api/availability`)
- Buat booking konsultasi: auto-assign dokter kosong, generate Google Meet link, kirim invite + reminder ke email pasien (`POST /api/bookings`)
- **Query booking** dengan filter fleksibel: tanggal, jam, dan/atau dokter tertentu (`GET /api/bookings`)
- **Batalkan booking** dan kirim notifikasi pembatalan otomatis ke pasien (`DELETE /api/bookings/:eventId`)
- Data 5 dokter umum masih hardcode di `src/config/doctors.js`
- Login OAuth2 cukup dilakukan **1 kali** lewat `scripts/oauth-login.js`, setelahnya backend pakai refresh token otomatis selamanya

## Struktur Project

```
clinic-calendar-proxy/
├── scripts/
│   └── oauth-login.js          # Script one-time login untuk dapat refresh token
├── src/
│   ├── config/
│   │   └── doctors.js          # Data 5 dokter (hardcode)
│   ├── services/
│   │   ├── googleAuth.js       # Setup OAuth2 client + refresh token
│   │   └── calendarService.js  # Semua logic ke Google Calendar API
│   ├── routes/
│   │   ├── availability.js     # GET /api/availability
│   │   └── booking.js          # GET /api/bookings, POST /api/bookings, DELETE /api/bookings/:eventId
│   ├── utils/
│   │   └── time.js             # Helper parsing jam & validasi
│   ├── app.js                  # Setup Express app
│   └── server.js               # Entry point
├── .env.example
└── package.json
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Buat OAuth Client di Google Cloud Console

1. Buka [console.cloud.google.com](https://console.cloud.google.com) → buat project baru
2. Enable **Google Calendar API** (APIs & Services → Library)
3. Konfigurasi **OAuth consent screen** dengan scope `https://www.googleapis.com/auth/calendar`
4. Buat **OAuth Client ID** (Application type: **Web application**)
5. Tambahkan Authorized redirect URI: `http://localhost:4000/oauth2callback`
6. Simpan **Client ID** dan **Client Secret**

### 3. Isi file `.env`

```bash
cp .env.example .env
```

Isi minimal `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di `.env`.

### 4. Login OAuth (one-time saja)

```bash
npm run oauth:login
```

- Buka link yang muncul di terminal
- Login pakai akun Google clinic (yang calendar-nya mau dipakai)
- Setelah authorize, `GOOGLE_REFRESH_TOKEN` otomatis tersimpan ke `.env`

Setelah step ini selesai, kamu **tidak perlu login manual lagi**. Backend akan otomatis refresh access token pakai refresh token setiap kali dibutuhkan.

### 5. Jalankan server

```bash
npm start
```

Server jalan di `http://localhost:3000`.

## Cara Pakai API

### Cek ketersediaan slot

```
GET /api/availability?date=2026-07-24&time=12:00
```

Response:
```json
{
  "date": "2026-07-24",
  "time": "12:00",
  "isFull": false,
  "availableSlots": 3,
  "availableDoctors": ["dr. Budi Santoso", "dr. Rina Wijaya", "dr. Hendra Kusuma"]
}
```

---

### Buat booking

```
POST /api/bookings
Content-Type: application/json

{
  "date": "2026-07-24",
  "time": "12:00",
  "email": "pasien@example.com"
}
```

Response sukses (201):
```json
{
  "message": "Booking berhasil dibuat.",
  "doctor": "dr. Budi Santoso",
  "date": "2026-07-24",
  "time": "12:00",
  "meetLink": "https://meet.google.com/xxx-yyyy-zzz",
  "eventId": "abc123",
  "eventLink": "https://calendar.google.com/event?eid=..."
}
```

Response kalau jam penuh (409):
```json
{
  "error": "Semua dokter sudah penuh di jam tersebut. Silakan pilih jam lain.",
  "isFull": true
}
```

---

### Query daftar booking

Semua query param bersifat **opsional**. Tanpa param → ambil semua booking ke depan (maks 100).

```
GET /api/bookings
GET /api/bookings?date=2026-07-24
GET /api/bookings?date=2026-07-24&time=12:00
GET /api/bookings?doctorId=dr-01
GET /api/bookings?date=2026-07-24&doctorId=dr-01
```

| Query Param | Tipe   | Keterangan                                              |
|-------------|--------|---------------------------------------------------------|
| `date`      | string | Filter tanggal (YYYY-MM-DD). Opsional.                 |
| `time`      | string | Filter slot jam (misal `12:00`). Butuh `date`.         |
| `doctorId`  | string | Filter dokter tertentu (misal `dr-01`). Opsional.      |

Response:
```json
{
  "total": 2,
  "filters": { "date": "2026-07-24", "time": null, "doctorId": null },
  "bookings": [
    {
      "eventId": "abc123",
      "summary": "Konsultasi dengan dr. Andi Pratama, M.Ked",
      "date": "2026-07-24",
      "time": "10:00",
      "doctor": { "id": "dr-01", "name": "dr. Andi Pratama, M.Ked" },
      "patientEmail": ["pasien@example.com"],
      "meetLink": "https://meet.google.com/xxx-yyyy-zzz",
      "eventLink": "https://calendar.google.com/event?eid=...",
      "status": "confirmed"
    }
  ]
}
```

---

### Batalkan booking

```
DELETE /api/bookings/:eventId
```

Ganti `:eventId` dengan nilai `eventId` yang didapat dari response POST `/api/bookings`.

Google Calendar akan otomatis **mengirim email notifikasi pembatalan** ke pasien.

Response sukses:
```json
{
  "message": "Booking berhasil dibatalkan. Notifikasi pembatalan dikirim ke pasien.",
  "eventId": "abc123"
}
```

Response jika event tidak ditemukan (404):
```json
{
  "error": "Booking tidak ditemukan atau sudah dibatalkan."
}
```

---

## Aturan Bisnis

- Jam praktik: **10.00 - 14.00**
- 5 dokter umum, masing-masing hanya bisa menerima **1 pasien per jam**
- Kapasitas maksimum: 5 dokter × 4 slot jam = **20 pasien per hari**
- Assignment dokter otomatis (bukan pasien yang pilih dokter)

## Daftar Dokter & ID

| ID      | Nama                         |
|---------|------------------------------|
| `dr-01` | dr. Andi Pratama, M.Ked      |
| `dr-02` | dr. Siti Nurhaliza, M.Ked    |
| `dr-03` | dr. Budi Santoso, M.Ked      |
| `dr-04` | dr. Rina Wijaya, M.Ked       |
| `dr-05` | dr. Hendra Kusuma, M.Ked     |

## Catatan

- Data dokter masih hardcode — kalau nanti butuh dinamis, tinggal ganti `src/config/doctors.js` jadi query ke database.
- Kalau refresh token ter-revoke atau expired (jarang terjadi, biasanya hanya kalau di-revoke manual dari akun Google), jalankan ulang `npm run oauth:login`.


## Struktur Project

```
clinic-calendar-proxy/
├── scripts/
│   └── oauth-login.js       # Script one-time login untuk dapat refresh token
├── src/
│   ├── config/
│   │   └── doctors.js       # Data 5 dokter (hardcode)
│   ├── services/
│   │   ├── googleAuth.js    # Setup OAuth2 client + refresh token
│   │   └── calendarService.js  # Semua logic ke Google Calendar API
│   ├── routes/
│   │   ├── availability.js  # GET /api/availability
│   │   └── booking.js       # POST /api/bookings
│   ├── utils/
│   │   └── time.js          # Helper parsing jam & validasi
│   ├── app.js                # Setup Express app
│   └── server.js             # Entry point
├── .env.example
└── package.json
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Buat OAuth Client di Google Cloud Console

1. Buka [console.cloud.google.com](https://console.cloud.google.com) → buat project baru
2. Enable **Google Calendar API** (APIs & Services → Library)
3. Konfigurasi **OAuth consent screen** dengan scope `https://www.googleapis.com/auth/calendar`
4. Buat **OAuth Client ID** (Application type: **Web application**)
5. Tambahkan Authorized redirect URI: `http://localhost:4000/oauth2callback`
6. Simpan **Client ID** dan **Client Secret**

### 3. Isi file `.env`

```bash
cp .env.example .env
```

Isi minimal `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di `.env`.

### 4. Login OAuth (one-time saja)

```bash
npm run oauth:login
```

- Buka link yang muncul di terminal
- Login pakai akun Google clinic (yang calendar-nya mau dipakai)
- Setelah authorize, `GOOGLE_REFRESH_TOKEN` otomatis tersimpan ke `.env`

Setelah step ini selesai, kamu **tidak perlu login manual lagi**. Backend akan otomatis refresh access token pakai refresh token setiap kali dibutuhkan.

### 5. Jalankan server

```bash
npm start
```

Server jalan di `http://localhost:3000`.

## Cara Pakai API

### Cek ketersediaan slot

```
GET /api/availability?date=2026-07-24&time=12:00
```

Response:
```json
{
  "date": "2026-07-24",
  "time": "12:00",
  "isFull": false,
  "availableSlots": 3,
  "availableDoctors": ["dr. Budi Santoso", "dr. Rina Wijaya", "dr. Hendra Kusuma"]
}
```

### Buat booking

```
POST /api/bookings
Content-Type: application/json

{
  "date": "2026-07-24",
  "time": "12:00",
  "email": "pasien@example.com"
}
```

Response sukses (201):
```json
{
  "message": "Booking berhasil dibuat.",
  "doctor": "dr. Budi Santoso",
  "date": "2026-07-24",
  "time": "12:00",
  "meetLink": "https://meet.google.com/xxx-yyyy-zzz",
  "eventId": "abc123",
  "eventLink": "https://calendar.google.com/event?eid=..."
}
```

Response kalau jam penuh (409):
```json
{
  "error": "Semua dokter sudah penuh di jam tersebut. Silakan pilih jam lain.",
  "isFull": true
}
```

## Aturan Bisnis

- Jam praktik: **10.00 - 14.00**
- 5 dokter umum, masing-masing hanya bisa menerima **1 pasien per jam**
- Kapasitas maksimum: 5 dokter × 4 slot jam = **20 pasien per hari**
- Assignment dokter otomatis (bukan pasien yang pilih dokter)

## Catatan

- Data dokter masih hardcode — kalau nanti butuh dinamis, tinggal ganti `src/config/doctors.js` jadi query ke database.
- Kalau refresh token ter-revoke atau expired (jarang terjadi, biasanya hanya kalau di-revoke manual dari akun Google), jalankan ulang `npm run oauth:login`.
