# Clinic Assistant API Documentation

## Autentikasi

Semua endpoint `/api/*` (kecuali `/api/auth/*`) memerlukan **refresh token** milik pengguna. Token harus disertakan di setiap request dengan salah satu cara berikut:

| Cara | Contoh |
|------|--------|
| **Body JSON** | `{ "refresh_token": "1//0g...", "date": "..." }` |
| **Authorization header** | `Authorization: Bearer 1//0g...` |
| **Query string (GET)** | `?refresh_token=1//0g...&date=2026-07-24` |

### Mendapatkan Refresh Token

1. Buka `GET /auth/login` di browser → login dengan akun Google
2. Setelah login, kamu akan diarahkan ke halaman yang menampilkan **refresh token**
3. Salin token tersebut dan simpan di variabel lokal / Botika variable

---

## Ringkasan Endpoint

### Auth (Tidak Perlu Token)

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/auth/login` | GET | Redirect ke halaman login Google |
| `/auth/callback` | GET | Callback OAuth dari Google (otomatis) |
| `/auth/token` | GET | Halaman tampilan refresh token |

### Auth Check (Cek Status Login)

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/api/auth/check` | POST / GET | Cek apakah refresh token valid |
| `/api/auth/email` | POST / GET | Ambil email akun dari refresh token |

### API Klinik (Memerlukan Token)

| Endpoint | Method | Fungsi |
|----------|--------|--------|
| `/api/availability` | POST / GET | Cek slot & dokter yang tersedia |
| `/api/doctors/list` | POST / GET | Daftar seluruh dokter |
| `/api/bookings` | POST | Buat booking baru |
| `/api/bookings/list` | POST | Query daftar booking |
| `/api/bookings/reschedule` | POST | Reschedule booking |
| `/api/bookings/cancel` | POST | Batalkan booking |

---

## Auth Endpoints

### GET /auth/login

Mengarahkan browser pengguna ke halaman consent Google OAuth. Tidak memerlukan token.

---

### POST /api/auth/check · GET /api/auth/check

Cek apakah `refresh_token` yang diberikan valid.

**Body Request (POST):**
```json
{ "refresh_token": "1//0g..." }
```

**GET Request:**
```
GET /api/auth/check?refresh_token=1//0g...
```

**Response — Token valid:**
```json
{
  "login_status": "pass",
  "login_url": ""
}
```

**Response — Token tidak ada / tidak valid:**
```json
{
  "login_status": "failed",
  "login_url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

---

### POST /api/auth/email · GET /api/auth/email

Ambil alamat email akun Google yang terhubung dengan `refresh_token`.

**Body Request (POST):**
```json
{ "refresh_token": "1//0g..." }
```

**Response sukses:**
```json
{
  "email": "user@gmail.com",
  "name": "User Name"
}
```

**Response jika token tidak valid (401):**
```json
{
  "login_status": "failed",
  "login_url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

---

## Respons Error Auth (untuk semua endpoint /api/* yang dilindungi)

Jika request tidak menyertakan `refresh_token` atau token tidak valid, server akan mengembalikan:

**Status 401:**
```json
{
  "login_status": "failed",
  "login_url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

---

## API Klinik

> Semua endpoint di bawah memerlukan `refresh_token` (lihat bagian Autentikasi di atas).

---

### 1. Cek Ketersediaan Slot

**Endpoint:** `POST /api/availability` · `GET /api/availability`

Mengecek jumlah slot kosong dan dokter yang tersedia pada tanggal dan jam tertentu.

**Body Request (POST):**
```json
{
  "refresh_token": "1//0g...",
  "date": "2026-07-24",
  "time": "12:00"
}
```

**Response:**
```json
{
  "date": "2026-07-24",
  "time": "12:00",
  "isFull": false,
  "availableSlots": 3,
  "availableDoctors": [
    { "id": "dr-01", "name": "dr. Andi Pratama, M.Ked" },
    { "id": "dr-02", "name": "dr. Siti Nurhaliza, M.Ked" }
  ]
}
```

---

### 2. Lihat Daftar Dokter

**Endpoint:** `GET /api/doctors/list` · `POST /api/doctors/list`

Menampilkan seluruh dokter yang terdaftar di klinik.

**Response:**
```json
{
  "total": 5,
  "doctors": [
    { "id": "dr-01", "name": "dr. Andi Pratama, M.Ked" },
    { "id": "dr-02", "name": "dr. Siti Nurhaliza, M.Ked" }
  ]
}
```

---

### 3. Buat Booking Konsultasi

**Endpoint:** `POST /api/bookings`

Pasien **memilih dokter sendiri** lewat `doctorId`. Gunakan `/api/availability` atau `/api/doctors/list` terlebih dahulu untuk cek dokter.

**Body Request:**
```json
{
  "refresh_token": "1//0g...",
  "date": "2026-07-24",
  "time": "12:00",
  "email": "pasien@example.com",
  "doctorId": "dr-03"
}
```

| Field | Tipe | Keterangan |
|-------|------|------------|
| `refresh_token` | string | Token Google pengguna. **Wajib.** |
| `date` | string | Tanggal konsultasi (YYYY-MM-DD). **Wajib.** |
| `time` | string | Jam konsultasi (misal `"12:00"`). **Wajib.** |
| `email` | string | Email pasien untuk undangan & reminder. **Wajib.** |
| `doctorId` | string | ID dokter yang dipilih (misal `"dr-03"`). **Wajib.** |

**Response sukses (201):**
```json
{
  "message": "Booking berhasil dibuat.",
  "eventId": "abc123",
  "doctor": { "id": "dr-03", "name": "dr. Budi Santoso, M.Ked" },
  "date": "2026-07-24",
  "time": "12:00",
  "meetLink": "https://meet.google.com/xxx-yyyy-zzz",
  "eventLink": "https://calendar.google.com/event?eid=..."
}
```

**Response jika dokter sudah penuh (409):**
```json
{
  "error": "dr. Budi Santoso, M.Ked sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.",
  "doctorId": "dr-03",
  "isFull": true
}
```

---

### 4. Query Daftar Booking

**Endpoint:** `POST /api/bookings/list`

Semua field opsional (kecuali `refresh_token`). Kirim `{}` + token untuk ambil semua booking ke depan (maks 100).

**Body Request:**
```json
{
  "refresh_token": "1//0g...",
  "date": "2026-07-24",
  "time": "12:00",
  "doctorId": "dr-01",
  "email": "pasien@example.com"
}
```

| Field | Tipe | Keterangan |
|-------|------|------------|
| `refresh_token` | string | Token Google pengguna. **Wajib.** |
| `date` | string | Filter tanggal (YYYY-MM-DD). Opsional. |
| `time` | string | Filter slot jam. Butuh `date`. Opsional. |
| `doctorId` | string | Filter dokter tertentu. Opsional. |
| `email` | string | Filter berdasarkan email pasien. Opsional. |

**Response:**
```json
{
  "total": 1,
  "filters": { "date": "2026-07-24", "time": null, "doctorId": null, "email": "pasien@example.com" },
  "doctorStatus": [
    { "id": "dr-01", "name": "dr. Andi Pratama, M.Ked", "status": "booked" },
    { "id": "dr-02", "name": "dr. Siti Nurhaliza, M.Ked", "status": "free" }
  ],
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

### 5. Reschedule Booking

**Endpoint:** `POST /api/bookings/reschedule`

Ganti tanggal, jam, dan/atau dokter. `eventId` wajib. Minimal satu field perubahan harus diisi. `date` dan `time` harus dikirim bersamaan jika salah satu diisi.

**Body Request:**
```json
{
  "refresh_token": "1//0g...",
  "eventId": "abc123",
  "date": "2026-07-25",
  "time": "13:00",
  "doctorId": "dr-02"
}
```

**Response sukses:**
```json
{
  "message": "Booking berhasil direschedule.",
  "eventId": "abc123",
  "doctor": { "id": "dr-02", "name": "dr. Siti Nurhaliza, M.Ked" },
  "date": "2026-07-25",
  "time": "13:00",
  "meetLink": "https://meet.google.com/xxx-yyyy-zzz",
  "eventLink": "https://calendar.google.com/event?eid=..."
}
```

---

### 6. Batalkan Booking

**Endpoint:** `POST /api/bookings/cancel`

Google Calendar otomatis **mengirim notifikasi pembatalan** ke email pasien. Mendukung pembatalan satu jadwal maupun beberapa sekaligus.

**Body Request (kirim salah satu: `eventId` ATAU `eventIds`):**
```json
{
  "refresh_token": "1//0g...",
  "eventIds": ["abc123", "def456"]
}
```

| Field | Tipe | Keterangan |
|-------|------|------------|
| `refresh_token` | string | Token Google pengguna. **Wajib.** |
| `eventId` | string | ID satu booking yang dibatalkan. Opsional. |
| `eventIds` | array | Daftar ID booking yang dibatalkan. Opsional. |

*Wajib mengirimkan minimal salah satu dari `eventId` atau `eventIds`.*

**Response sukses (200):**
```json
{
  "message": "Berhasil membatalkan 2 booking.",
  "deletedCount": 2,
  "deletedIds": ["abc123", "def456"],
  "failedCount": 0,
  "failedIds": []
}
```
