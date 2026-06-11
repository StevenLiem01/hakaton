const express = require('express');
const admin = require('firebase-admin');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

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
            const replyPesan = `Halo *${data.nama}*! 🧺✨\n\nBerikut adalah *update* status cucianmu:\n\n🔖 *Layanan:* ${data.layanan}\n⚖️ *Berat:* ${data.berat} kg\n💰 *Total Tagihan:* Rp ${Number(data.totalHarga).toLocaleString('id-ID')}\n\n📍 *STATUS SAAT INI:*\n[ ${iconStatus} *${statusSaatIni}* ]\n\nTerima kasih telah menggunakan layanan FreshPOS!`;
            
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

        // 3. Siapkan teks informasi diskon & catatan secara kondisional
        let teksDiskon = diskonAktif > 0 ? `\n🏷️ *Diskon:* - Rp ${diskonAktif.toLocaleString('id-ID')}` : '';
        let teksCatatan = (catatanAktif && catatanAktif !== '-' && catatanAktif !== '') ? `\n📝 *Catatan:* ${catatanAktif}` : '';

        // 4. Kirim Struk Digital via WhatsApp (akan dinamis menyesuaikan ada/tidaknya diskon & catatan)
        const pesanWA = `Halo *${nama}*! 🧺✨\n\nPesanan laundry kamu sudah kami terima dan sedang *DIPROSES*. Berikut detailnya:\n\n🔖 *No. Struk:* ${pesananBaru.id}\n👕 *Layanan:* ${layanan}\n⚖️ *Berat:* ${berat} kg${teksDiskon}${teksCatatan}\n💰 *Total Tagihan:* Rp ${Number(totalHarga).toLocaleString('id-ID')}\n\nKami akan mengabari kembali jika cucianmu sudah wangi dan siap diambil. Terima kasih! 🙏`;

        await client.sendMessage(formattedNumber, pesanWA);

        res.json({ success: true, message: 'Pesanan berhasil dibuat dan WA terkirim.', idPesanan: pesananBaru.id });

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
        res.attachment('Laporan_Transaksi_FreshPOS.csv');
        res.send(csv);

    } catch (error) {
        const waktu = new Date().toLocaleString('id-ID');
        fs.appendFileSync('logs.txt', `[${waktu}] ERROR EXPORT:\n${error.stack}\n-----------------------------------\n`);
        res.status(500).send('Gagal membuat file CSV');
    }
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