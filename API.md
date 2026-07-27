# Clinic Assistant API Documentation

Semua endpoint secara default bisa diakses menggunakan **method POST** dengan body `Content-Type: application/json` untuk memudahkan integrasi dengan webhook/chatbot builder seperti Botika yang mungkin membatasi method HTTP yang bisa digunakan.

## Ringkasan Endpoint

| Endpoint | Fungsi |
|----------|--------|
| `POST /api/availability` | Cek slot & dokter yang tersedia |
| `POST /api/doctors/list` | Menampilkan daftar seluruh dokter |
| `POST /api/bookings` | Buat booking baru |
| `POST /api/bookings/list` | Query daftar booking |
| `POST /api/bookings/reschedule` | Reschedule booking |
| `POST /api/bookings/cancel` | Batalkan booking |

---

### 1. Cek Ketersediaan Slot (Cek Jadwal)

**Endpoint:** `POST /api/availability`

Mengecek jumlah slot kosong dan dokter yang tersedia pada tanggal dan jam tertentu.

**Body Request:**
```json
{
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

### 2. Lihat Daftar Dokter (Lihat Dokter)

**Endpoint:** `GET /api/doctors/list` atau `POST /api/doctors/list`

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

### 3. Buat Booking Konsultasi (Tambah Jadwal)

**Endpoint:** `POST /api/bookings`

Pasien **memilih dokter sendiri** lewat `doctorId`. Gunakan `POST /api/availability` atau `POST /api/doctors/list` terlebih dahulu untuk cek dokter.

**Body Request:**
```json
{
  "date": "2026-07-24",
  "time": "12:00",
  "email": "pasien@example.com",
  "doctorId": "dr-03"
}
```

| Field      | Tipe   | Keterangan                                      |
|------------|--------|-------------------------------------------------|
| `date`     | string | Tanggal konsultasi (YYYY-MM-DD). Wajib.         |
| `time`     | string | Jam konsultasi (misal `"12:00"`). Wajib.        |
| `email`    | string | Email pasien untuk undangan & reminder. Wajib.  |
| `doctorId` | string | ID dokter yang dipilih (misal `"dr-03"`). Wajib.|

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

**Response jika dokter sudah penuh di jam itu (409):**
```json
{
  "error": "dr. Budi Santoso, M.Ked sudah penuh di jam tersebut. Silakan pilih jam atau dokter lain.",
  "doctorId": "dr-03",
  "isFull": true
}
```

---

### 4. Query Daftar Booking (Cek Jadwal Pasien)

**Endpoint:** `POST /api/bookings/list`

Semua field opsional. Kirim `{}` untuk ambil semua booking ke depan (maks 100).
Jika variable kosong (seperti `""`, `"null"`, atau unresolved `{{...}}`), sistem akan mengabaikannya (menjadi `null`).

**Body Request:**
```json
{
  "date": "2026-07-24",
  "time": "12:00",
  "doctorId": "dr-01",
  "email": "pasien@example.com"
}
```

| Field      | Tipe   | Keterangan                                           |
|------------|--------|------------------------------------------------------|
| `date`     | string | Filter tanggal (YYYY-MM-DD). Opsional.               |
| `time`     | string | Filter slot jam (misal `"12:00"`). Butuh `date`.     |
| `doctorId` | string | Filter dokter tertentu (misal `"dr-01"`). Opsional.  |
| `email`    | string | Filter berdasarkan email pasien. Opsional.           |

**Response:**
```json
{
  "total": 1,
  "filters": { "date": "2026-07-24", "time": null, "doctorId": null, "email": "pasien@example.com" },
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

### 5. Reschedule Booking (Ubah Jadwal)

**Endpoint:** `POST /api/bookings/reschedule`

Ganti tanggal, jam, dan/atau dokter. `eventId` wajib. Minimal satu field perubahan harus diisi. `date` dan `time` harus dikirim bersamaan jika salah satu diisi.

**Body Request:**
```json
{
  "eventId": "abc123",
  "date": "2026-07-25",
  "time": "13:00",
  "doctorId": "dr-02"
}
```

| Field      | Tipe   | Keterangan                                                     |
|------------|--------|----------------------------------------------------------------|
| `eventId`  | string | ID booking yang akan direschedule. **Wajib**.                  |
| `date`     | string | Tanggal baru (YYYY-MM-DD). Harus berpasangan dengan `time`.    |
| `time`     | string | Jam baru. Harus berpasangan dengan `date`.                     |
| `doctorId` | string | Dokter pengganti. Opsional, bisa diganti tanpa ganti jadwal.   |

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

### 6. Batalkan Booking (Hapus Jadwal)

**Endpoint:** `POST /api/bookings/cancel`

Google Calendar otomatis **mengirim notifikasi pembatalan** ke email pasien. Pembatalan menggunakan `eventId`.

**Body Request:**
```json
{
  "eventId": "abc123"
}
```

**Response sukses:**
```json
{
  "message": "Booking berhasil dibatalkan. Notifikasi pembatalan dikirim ke pasien.",
  "eventId": "abc123"
}
```

**Response jika tidak ditemukan (404):**
```json
{
  "error": "Booking tidak ditemukan atau sudah dibatalkan."
}
```
