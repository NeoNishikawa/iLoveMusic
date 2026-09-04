# Production deployment

Project ini adalah aplikasi Node.js sederhana yang menyajikan `index.html` existing dan API Spotify melalui server yang sama. Desain frontend tidak perlu dipindahkan atau dibangun ulang.

## Menjalankan secara lokal

```bash
cp .env.example .env
# isi SPOTIFY_CLIENT_ID dan SPOTIFY_CLIENT_SECRET di .env
npm start
```

Aplikasi berjalan pada port dari `PORT`, atau `3000` jika variabel tersebut tidak diatur. Endpoint pemeriksaan kesehatan tersedia pada `/health`.

## Publish ke hosting Node.js

Pilih runtime Node.js 20 atau yang lebih baru, gunakan perintah build kosong, dan gunakan perintah start berikut:

```bash
npm start
```

Tambahkan environment variables berikut pada dashboard hosting. Jangan upload file `.env` dan jangan memasukkan nilai rahasia ke source code.

| Variable | Wajib | Keterangan |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | Ya | Client ID aplikasi Spotify |
| `SPOTIFY_CLIENT_SECRET` | Ya | Client Secret aplikasi Spotify; server-only |
| `SPOTIFY_API_KEY` | Tidak | Hanya jika nantinya dipakai oleh integrasi tambahan |
| `NODE_ENV` | Disarankan | Gunakan `production` |
| `PORT` | Biasanya otomatis | Hosting umumnya mengisi nilai ini sendiri |
| `SSE_REFRESH_MS` | Tidak | Interval refresh server-side dalam milidetik; default `300000` |

Health check hosting dapat diarahkan ke:

```text
GET /health
```

Untuk home data, browser memakai satu koneksi Server-Sent Events:

```text
GET /api/events
```

Server mengirim event `home` dari cache dan melakukan refresh Spotify secara server-side sesuai `SSE_REFRESH_MS`. Nilai defaultnya adalah 5 menit. Dengan demikian, frontend tidak melakukan polling `/api/home` berulang-ulang.

Respons suksesnya adalah JSON sederhana dengan status `ok` dan endpoint tersebut tidak membutuhkan kredensial Spotify.

## Publish dengan Docker

Repository sudah menyertakan `Dockerfile`. Hosting yang mendukung Docker dapat menjalankan:

```bash
docker build -t ilovemusic .
docker run --rm -p 3000:3000 \
  -e SPOTIFY_CLIENT_ID="..." \
  -e SPOTIFY_CLIENT_SECRET="..." \
  -e NODE_ENV=production \
  ilovemusic
```

Server mendengarkan pada `0.0.0.0` dan menghormati `PORT` yang diberikan platform hosting.

## Keamanan

`SPOTIFY_CLIENT_SECRET` dan access token tidak pernah dikirim ke browser. Access token hanya disimpan di memory proses server. Pastikan environment variables dibuat melalui secret manager atau dashboard hosting, dan jangan menyalin credential ke `index.html`, browser JavaScript, URL, atau `localStorage`.
