const express = require('express');
const admin = require('firebase-admin');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');

// ==========================================
// HELPER: Template HTML Struk Digital
// ==========================================
function buatHtmlStruk(d, qrDataUrl, id) {
    const tgl = new Date().toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const diskonRow = d.diskon > 0 ? `<div class="row"><span class="k">Diskon</span><span class="v" style="color:#ef4444">− Rp ${Number(d.diskon).toLocaleString('id-ID')}</span></div>` : '';
    const catatanBox = (d.catatan && d.catatan !== '-') ? `<div class="catatan">📝 ${d.catatan}</div>` : '';
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:400px;font-family:'Segoe UI',Arial,sans-serif;background:#fff;padding:24px}
.header{text-align:center;margin-bottom:18px;padding-bottom:14px;border-bottom:2px dashed #e2e8f0}
.logo{font-size:22px;font-weight:800;color:#0f7aff}.tagline{font-size:11px;color:#94a3b8;margin-top:2px}
.title{font-size:11px;font-weight:700;color:#475569;margin-top:6px;letter-spacing:1px;text-transform:uppercase}
.row{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid #f1f5f9}
.k{color:#64748b}.v{font-weight:600;color:#1e293b;text-align:right}
.total{background:linear-gradient(135deg,#0f7aff,#0063d8);border-radius:12px;padding:14px 18px;color:#fff;margin:14px 0}
.tlabel{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.5px}.tvalue{font-size:24px;font-weight:800;margin-top:4px}
.qrbox{text-align:center;padding:12px;background:#f8fafc;border-radius:12px;margin-bottom:12px}
.qrlabel{font-size:11px;color:#64748b;margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.qrbox img{width:130px;height:130px}.qrhint{font-size:10px;color:#94a3b8;margin-top:6px;line-height:1.5}
.oid{font-size:10px;color:#94a3b8;text-align:center;font-family:monospace;margin-bottom:10px}
.catatan{font-size:11px;background:#fffbeb;border-left:3px solid #f59e0b;padding:8px 10px;border-radius:0 6px 6px 0;color:#92400e;margin:10px 0}
.footer{text-align:center;font-size:11px;color:#94a3b8;padding-top:12px;border-top:2px dashed #e2e8f0;line-height:1.7}
.footer strong{color:#0f7aff}.badge{background:rgba(15,122,255,.12);color:#0f7aff;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700}
</style></head><body>
<div class="header"><div class="logo">🧺 FreshFlow</div><div class="tagline">Laundry Management System</div><div class="title">Struk Transaksi Digital</div></div>
<div>
  <div class="row"><span class="k">Nama</span><span class="v">${d.nama}</span></div>
  <div class="row"><span class="k">No. WA</span><span class="v">${d.noWa}</span></div>
  <div class="row"><span class="k">Layanan</span><span class="v">${d.layanan}</span></div>
  <div class="row"><span class="k">Berat</span><span class="v">${d.berat} kg</span></div>
  ${diskonRow}
  <div class="row"><span class="k">Tanggal</span><span class="v">${tgl}</span></div>
  <div class="row"><span class="k">Status</span><span class="v"><span class="badge">⏳ Diproses</span></span></div>
</div>
${catatanBox}
<div class="total"><div class="tlabel">Total Tagihan</div><div class="tvalue">Rp ${Number(d.totalHarga).toLocaleString('id-ID')}</div></div>
<div class="qrbox">
  <div class="qrlabel">📱 Scan untuk Cek Status & Pengambilan</div>
  <img src="${qrDataUrl}" alt="QR"/>
  <div class="qrhint">Tunjukkan QR ini kepada pegawai saat pengambilan cucian</div>
</div>
<div class="oid">No. Struk: ${id}</div>
<div class="footer">Terima kasih telah menggunakan <strong>FreshFlow</strong>! 🙏<br>Cucianmu sedang kami proses ✨</div>
</body></html>`;
}

// ==========================================
// HELPER: Generate Struk PNG + PDF
// ==========================================
async function generateStrukMedia(data, idPesanan) {
    const orderUrl = `http://localhost:3000/order/${idPesanan}`;
    const qrDataUrl = await QRCode.toDataURL(orderUrl, { width: 150, margin: 1, color: { dark: '#0f7aff', light: '#ffffff' } });
    const html = buatHtmlStruk(data, qrDataUrl, idPesanan);

    const receiptDir = path.join(__dirname, 'receipts');
    fs.mkdirSync(receiptDir, { recursive: true });

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.setViewport({ width: 400, height: 800, deviceScaleFactor: 2 });

    const pngBuffer = await page.screenshot({ fullPage: true, type: 'png' });
    const pdfBuffer = await page.pdf({ width: '400px', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
    await browser.close();

    fs.writeFileSync(path.join(receiptDir, `${idPesanan}.pdf`), pdfBuffer);
    return { pngBuffer };
}

const app = express();

// Middleware untuk memproses JSON dan membaca file HTML/CSS statis di folder
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// 1. Inisialisasi Firebase Database
// ==========================================
const serviceAccount = require('./firebase-key.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
console.log('✅ Firebase berhasil diinisialisasi.');

// ==========================================
// 2. Inisialisasi WhatsApp Client
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    console.log('Tolong scan QR Code di bawah ini menggunakan aplikasi WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client siap mengirim pesan!');
});

// ==========================================
// FITUR BOT AUTO-REPLY WHATSAPP 🤖
// ==========================================
client.on('message_create', async msg => {
    // Ambil teks pesan masuk dan bersihkan spasi ekstra
    const pesan = msg.body.trim();

    // Cek apakah pesan diawali dengan kata '!status' (huruf besar/kecil bebas)
    if (pesan.toLowerCase().startsWith('!status')) {

        // Pecah pesan untuk mengambil ID pesanan. Contoh: "!status TRX-001" -> ["!status", "TRX-001"]
        const parts = pesan.split(' ');

        // Jika pelanggan hanya mengetik "!status" tanpa ID
        if (parts.length < 2) {
            return msg.reply('Halo! 🤖 Untuk mengecek status cucianmu, silakan balas dengan format:\n\n*!status <ID_PESANAN>*\n\nContoh: *!status pu8x7ziVY...*');
        }

        // Ambil ID pesanan dari kata kedua
        const idPesanan = parts[1].trim();

        try {
            // Cari dokumen pesanan di database Firebase
            const doc = await db.collection('pesanan_laundry').doc(idPesanan).get();

            // Jika ID tidak ditemukan di database
            if (!doc.exists) {
                return msg.reply(`Maaf, pesanan dengan ID *${idPesanan}* tidak ditemukan di sistem kami. Coba periksa kembali nomor ID yang ada di struk WhatsApp kamu ya! 🙏`);
            }

            // Jika ID ditemukan, ambil datanya
            const data = doc.data();
            const statusSaatIni = data.status.toUpperCase();

            // Berikan dekorasi centang jika sudah selesai
            const iconStatus = statusSaatIni === 'SELESAI' ? '✅' : '⏳';

            // Susun template balasan
            const replyPesan = `Halo *${data.nama}*! 🧺✨\n\nBerikut adalah *update* status cucianmu:\n\n🔖 *Layanan:* ${data.layanan}\n⚖️ *Berat:* ${data.berat} kg\n💰 *Total Tagihan:* Rp ${Number(data.totalHarga).toLocaleString('id-ID')}\n\n📍 *STATUS SAAT INI:*\n[ ${iconStatus} *${statusSaatIni}* ]\n\nTerima kasih telah menggunakan layanan FreshFlow!`;

            // Kirim balasan
            msg.reply(replyPesan);

        } catch (error) {
            // Log error ke terminal jika Firebase bermasalah
            console.error("Error cek status bot:", error);
            msg.reply('Maaf, sedang ada perbaikan sistem sehingga bot tidak bisa mengecek status. Coba beberapa saat lagi ya! 🛠️');
        }
    }
});
client.initialize();

// ==========================================
// 3. Routing (API Endpoints) Utama
// ==========================================

// A. Rute Halaman Utama (Kasir)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// B. API untuk Verifikasi Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const snapshot = await db.collection('akun_kasir').where('username', '==', username).get();

        if (snapshot.empty) {
            return res.json({ success: false, message: 'Username tidak terdaftar!' });
        }

        let loginSukses = false;
        snapshot.forEach(doc => {
            const dataAkun = doc.data();
            if (dataAkun.password === password) {
                loginSukses = true;
            }
        });

        if (loginSukses) {
            res.json({ success: true, token: 'laundry-token-rahasia' });
        } else {
            res.json({ success: false, message: 'Password yang kamu masukkan salah!' });
        }

    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        const pesanLog = `[${waktu}] ERROR LOGIN:\n${error.stack}\n-----------------------------------\n`;
        fs.appendFileSync('logs.txt', pesanLog);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat login.' });
    }
});

// C. API untuk Membuat Pesanan Baru & Kirim WA
app.post('/buat-pesanan', async (req, res) => {
    // Tangkap tambahan data diskon dan catatan dari frontend
    const { nama, noWa, berat, layanan, totalHarga, diskon, catatan } = req.body;

    try {
        const waktuSekarang = new Date();
        const diskonAktif = Number(diskon) || 0;
        const catatanAktif = catatan || '-';

        // 1. Simpan data ke Firebase Database (termasuk diskon & catatan)
        const pesananBaru = await db.collection('pesanan_laundry').add({
            nama,
            noWa,
            berat,
            layanan,
            totalHarga,
            diskon: diskonAktif,
            catatan: catatanAktif,
            status: 'Diproses',
            tanggal: waktuSekarang,
            reminderTerkirim: false
        });

        // 2. Format nomor WA
        let formattedNumber = String(noWa).replace(/\D/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substring(1);
        }
        formattedNumber += '@c.us';

        // 3. Generate QR Code + Struk gambar & PDF
        const strukturData = { nama, noWa, berat, layanan, totalHarga: Number(totalHarga), diskon: diskonAktif, catatan: catatanAktif };
        const { pngBuffer } = await generateStrukMedia(strukturData, pesananBaru.id);

        // 4. Kirim Struk sebagai Gambar via WhatsApp
        const pngBase64 = pngBuffer.toString('base64');
        const media = new MessageMedia('image/png', pngBase64, `struk-${pesananBaru.id}.png`);
        const captionWA = `Halo *${nama}*! 🧺✨\n\nStruk digital pesananmu sudah siap! Simpan gambar ini dan tunjukkan *QR Code*-nya saat pengambilan.\n\n🔖 *No. Struk:* ${pesananBaru.id}\n📍 *Status:* Diproses\n\nKami kabari lagi kalau cucianmu sudah selesai! 🙏`;
        await client.sendMessage(formattedNumber, media, { caption: captionWA });

        res.json({ success: true, message: 'Pesanan berhasil dibuat dan struk gambar terkirim!', idPesanan: pesananBaru.id });

    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        const pesanLog = `[${waktu}] ERROR BUAT PESANAN:\n${error.stack}\n-----------------------------------\n`;
        fs.appendFileSync('logs.txt', pesanLog);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem saat membuat pesanan.' });
    }
});

// ==========================================
// 4. Routing (API Endpoints) Lanjutan
// ==========================================

// D. API untuk Mengambil Riwayat Pesanan (GET)
app.get('/api/riwayat', async (req, res) => {
    try {
        const snapshot = await db.collection('pesanan_laundry').orderBy('tanggal', 'desc').get();
        const riwayat = snapshot.docs.map(doc => {
            const data = doc.data();

            if (data.tanggal && data.tanggal._seconds) {
                data.tanggal = new Date(data.tanggal._seconds * 1000).toLocaleString('id-ID', {
                    dateStyle: 'medium', timeStyle: 'short'
                });
            } else {
                data.tanggal = '-';
            }

            return { id: doc.id, ...data };
        });
        res.json({ success: true, data: riwayat });
    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        const pesanLog = `[${waktu}] ERROR AMBIL RIWAYAT:\n${error.stack}\n-----------------------------------\n`;
        fs.appendFileSync('logs.txt', pesanLog);
        res.status(500).json({ success: false, message: 'Gagal mengambil data riwayat.' });
    }
});

// E. API untuk Update Status & Kirim WA Selesai (POST)
app.post('/api/update-status', async (req, res) => {
    const { idPesanan, nama, noWa } = req.body;

    try {
        await db.collection('pesanan_laundry').doc(idPesanan).update({
            status: 'Selesai'
        });

        if (!noWa || noWa === 'undefined' || String(noWa).trim() === '') {
            return res.json({ success: true, message: 'Status diupdate (WA tidak dikirim karena nomor kosong).' });
        }

        let formattedNumber = String(noWa).replace(/\D/g, '');

        if (formattedNumber.length < 8) {
            return res.json({ success: true, message: 'Status diupdate (WA tidak dikirim karena nomor tidak valid).' });
        }

        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substring(1);
        }
        formattedNumber += '@c.us';

        const pesanSelesai = `Halo *${nama}*! 🧺✨\n\nKabar gembira, cucianmu dengan No. Struk *${idPesanan}* sudah wangi, rapi, dan *SIAP DIAMBIL* di toko kami.\n\nTerima kasih sudah mempercayakan cucianmu pada LaundryKu!`;

        await client.sendMessage(formattedNumber, pesanSelesai);

        res.json({ success: true, message: 'Status diupdate & WA Selesai terkirim!' });
    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        const pesanLog = `[${waktu}] ERROR UPDATE STATUS:\n${error.stack}\n-----------------------------------\n`;
        fs.appendFileSync('logs.txt', pesanLog);
        res.status(500).json({ success: false, message: 'Gagal update status pesanan. Silakan cek logs.txt' });
    }
});

// F. API untuk Data Dashboard (GET)
app.get('/api/dashboard', async (req, res) => {
    try {
        const hariIni = new Date();
        hariIni.setHours(0, 0, 0, 0);

        const snapshot = await db.collection('pesanan_laundry')
            .where('tanggal', '>=', hariIni)
            .orderBy('tanggal', 'desc')
            .get();

        let totalPesanan = 0;
        let totalPendapatan = 0;
        let aktivitasTerbaru = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            totalPesanan += 1;
            totalPendapatan += Number(data.totalHarga) || 0;

            if (aktivitasTerbaru.length < 5) {
                let waktuFormat = '-';
                if (data.tanggal && data.tanggal._seconds) {
                    waktuFormat = new Date(data.tanggal._seconds * 1000).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                }

                aktivitasTerbaru.push({
                    id: doc.id,
                    nama: data.nama,
                    layanan: data.layanan,
                    berat: data.berat,
                    totalHarga: data.totalHarga,
                    status: data.status,
                    waktu: waktuFormat
                });
            }
        });

        res.json({
            success: true,
            data: {
                totalPesanan,
                totalPendapatan,
                aktivitasTerbaru
            }
        });
    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        const pesanLog = `[${waktu}] ERROR AMBIL DASHBOARD:\n${error.stack}\n-----------------------------------\n`;
        fs.appendFileSync('logs.txt', pesanLog);
        res.status(500).json({ success: false, message: 'Gagal memuat data dashboard.' });
    }
});

// G. API untuk Export Data CSV (GET)
app.get('/api/export/csv', async (req, res) => {
    try {
        const snapshot = await db.collection('pesanan_laundry').orderBy('tanggal', 'desc').get();

        let csv = 'ID Pesanan;Tanggal;Nama Pelanggan;No WhatsApp;Layanan;Berat (kg);Diskon (Rp);Catatan;Total Harga (Rp);Status\n';

        snapshot.forEach(doc => {
            const data = doc.data();

            let tanggal = '-';
            if (data.tanggal && data.tanggal._seconds) {
                tanggal = new Date(data.tanggal._seconds * 1000).toLocaleString('id-ID').replace(/,/g, '');
            }

            const nama = `"${data.nama || ''}"`;
            const layanan = `"${data.layanan || ''}"`;
            const noWa = `"${data.noWa || ''}"`;
            const catatan = `"${data.catatan || '-'}"`;
            const diskon = data.diskon || 0;

            csv += `${doc.id};${tanggal};${nama};${noWa};${layanan};${data.berat};${diskon};${catatan};${data.totalHarga};${data.status}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment('Laporan_Transaksi_FreshFlow.csv');
        res.send(csv);

    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        fs.appendFileSync('logs.txt', `[${waktu}] ERROR EXPORT:\n${error.stack}\n-----------------------------------\n`);
        res.status(500).send('Gagal membuat file CSV');
    }
});

// ==========================================
// I. Halaman Publik Detail Pesanan (via QR)
// ==========================================
app.get('/order/:id', async (req, res) => {
    try {
        const doc = await db.collection('pesanan_laundry').doc(req.params.id).get();
        if (!doc.exists) return res.status(404).send('<h2>Pesanan tidak ditemukan.</h2>');
        const data = doc.data();
        const tgl = data.tanggal?._seconds ? new Date(data.tanggal._seconds * 1000).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' }) : '-';
        const isSelesai = data.status?.toLowerCase() === 'selesai';
        res.send(`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status Pesanan — FreshFlow</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#f0f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:20px;padding:28px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(10,22,40,.1)}
.logo{font-size:20px;font-weight:800;color:#0f7aff;text-align:center;margin-bottom:4px}
.sub{text-align:center;font-size:12px;color:#94a3b8;margin-bottom:20px}
.status-box{border-radius:14px;padding:16px 20px;text-align:center;margin-bottom:20px;${isSelesai ? 'background:rgba(0,184,148,.1);border:1.5px solid rgba(0,184,148,.3)' : 'background:rgba(15,122,255,.08);border:1.5px solid rgba(15,122,255,.2)'}}
.status-icon{font-size:28px;margin-bottom:6px}.status-label{font-size:18px;font-weight:800;color:${isSelesai ? '#00b894' : '#0f7aff'}}
.row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px;border-bottom:1px solid #f1f5f9}
.k{color:#64748b}.v{font-weight:600;color:#1e293b}
.total{background:linear-gradient(135deg,#0f7aff,#0063d8);border-radius:12px;padding:14px 16px;color:#fff;margin:16px 0;text-align:center}
.tl{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.5px}.tv{font-size:22px;font-weight:800;margin-top:4px}
.footer{text-align:center;font-size:12px;color:#94a3b8;margin-top:16px}
</style></head><body><div class="card">
<div class="logo">🧺 FreshFlow</div><div class="sub">Status Pesanan Laundry</div>
<div class="status-box"><div class="status-icon">${isSelesai ? '✅' : '⏳'}</div><div class="status-label">${isSelesai ? 'SIAP DIAMBIL' : 'SEDANG DIPROSES'}</div></div>
<div class="row"><span class="k">Nama</span><span class="v">${data.nama}</span></div>
<div class="row"><span class="k">Layanan</span><span class="v">${data.layanan}</span></div>
<div class="row"><span class="k">Berat</span><span class="v">${data.berat} kg</span></div>
<div class="row"><span class="k">Tanggal Masuk</span><span class="v">${tgl}</span></div>
<div class="row"><span class="k">No. Struk</span><span class="v" style="font-family:monospace;font-size:11px">${doc.id}</span></div>
<div class="total"><div class="tl">Total Tagihan</div><div class="tv">Rp ${Number(data.totalHarga).toLocaleString('id-ID')}</div></div>
<div class="footer">Powered by <strong style="color:#0f7aff">FreshFlow</strong> Laundry System</div>
</div></body></html>`);
    } catch (err) {
        res.status(500).send('Terjadi kesalahan sistem.');
    }
});

// J. API JSON untuk Scanner Dashboard (GET)
app.get('/api/order/:id', async (req, res) => {
    try {
        const doc = await db.collection('pesanan_laundry').doc(req.params.id).get();
        if (!doc.exists) return res.json({ success: false, message: 'Pesanan tidak ditemukan.' });
        const data = doc.data();
        if (data.tanggal?._seconds) data.tanggal = new Date(data.tanggal._seconds * 1000).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
        res.json({ success: true, data: { id: doc.id, ...data } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Gagal mengambil data.' });
    }
});

// K. Download PDF Struk (GET)
app.get('/api/struk/:id/pdf', (req, res) => {
    const pdfPath = path.join(__dirname, 'receipts', `${req.params.id}.pdf`);
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ message: 'PDF tidak ditemukan. Buat pesanan ulang untuk generate PDF.' });
    res.download(pdfPath, `Struk-FreshFlow-${req.params.id}.pdf`);
});

// H. API untuk Statistik Grafik (GET)
app.get('/api/statistik', async (req, res) => {
    try {
        const sebulanLalu = new Date();
        sebulanLalu.setDate(sebulanLalu.getDate() - 30);

        const snapshot = await db.collection('pesanan_laundry')
            .where('tanggal', '>=', sebulanLalu)
            .orderBy('tanggal', 'asc')
            .get();

        const statistikHarian = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.tanggal && data.tanggal._seconds) {
                const dateObj = new Date(data.tanggal._seconds * 1000);
                const tglStr = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

                if (!statistikHarian[tglStr]) {
                    statistikHarian[tglStr] = { pendapatan: 0, pesanan: 0 };
                }

                statistikHarian[tglStr].pendapatan += Number(data.totalHarga) || 0;
                statistikHarian[tglStr].pesanan += 1;
            }
        });

        const labels = Object.keys(statistikHarian);
        const dataPendapatan = labels.map(tgl => statistikHarian[tgl].pendapatan);
        const dataPesanan = labels.map(tgl => statistikHarian[tgl].pesanan);

        res.json({
            success: true,
            data: { labels, pendapatan: dataPendapatan, pesanan: dataPesanan }
        });

    } catch (error) {
        console.error('Error load statistik:', error);
        res.status(500).json({ success: false, message: 'Gagal memuat statistik.' });
    }
});

// ==========================================
// 5. API Pengaturan (GET & POST)
// ==========================================

app.get('/api/pengaturan', async (req, res) => {
    try {
        const doc = await db.collection('pengaturan').doc('harga_layanan').get();
        if (!doc.exists) {
            return res.json({ success: true, data: { "Cuci Komplit": 6000, "Cuci Kering": 5000, "Setrika Saja": 4000 } });
        }
        res.json({ success: true, data: doc.data() });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Gagal mengambil pengaturan.' });
    }
});

app.post('/api/pengaturan', async (req, res) => {
    try {
        await db.collection('pengaturan').doc('harga_layanan').set(req.body);
        res.json({ success: true, message: 'Harga berhasil diperbarui!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Gagal menyimpan pengaturan.' });
    }
});

// ==========================================
// 6. CRON JOB: PENGINGAT CUCIAN (Setiap Jam 09:00 Pagi)
// ==========================================
cron.schedule('0 9 * * *', async () => {
    console.log('⏰ [CRON] Mengecek cucian yang belum diambil...');

    try {
        const snapshot = await db.collection('pesanan_laundry')
            .where('status', '==', 'Selesai')
            .get();

        if (snapshot.empty) {
            console.log('⏰ [CRON] Tidak ada cucian selesai yang tertunda.');
            return;
        }

        const sekarang = new Date();

        snapshot.forEach(async (doc) => {
            const data = doc.data();

            if (data.reminderTerkirim) return;

            if (data.tanggal && data.tanggal._seconds) {
                const tanggalPesanan = new Date(data.tanggal._seconds * 1000);
                const selisihWaktu = sekarang - tanggalPesanan;

                const selisihHari = Math.floor(selisihWaktu / (1000 * 60 * 60 * 24));

                if (selisihHari >= 3) {
                    let noWa = String(data.noWa).replace(/\D/g, '');
                    if (noWa.startsWith('0')) noWa = '62' + noWa.substring(1);
                    noWa += '@c.us';

                    const pesanReminder = `Halo *${data.nama}*! ⏰🧺\n\nSekadar mengingatkan, cucianmu dengan No. Struk *${doc.id}* sudah selesai dan menunggumu di toko kami sejak *3 hari yang lalu*.\n\nYuk, segera diambil agar bajunya tetap wangi dan keranjang kami bisa digunakan kembali! Terima kasih. 🙏`;

                    await client.sendMessage(noWa, pesanReminder);

                    await db.collection('pesanan_laundry').doc(doc.id).update({
                        reminderTerkirim: true
                    });

                    console.log(`✅ [CRON] Pengingat berhasil terkirim ke ${data.nama}`);
                }
            }
        });
    } catch (error) {
        console.error('❌ [CRON] Error saat mengecek pengingat:', error);
    }
});

// ==========================================
// 7. Jalankan Server
// ==========================================
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server & Halaman Kasir berjalan di http://localhost:${PORT}`);
});