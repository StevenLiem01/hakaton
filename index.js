const express = require('express');
const admin = require('firebase-admin');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
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
let db;
let serviceAccount;
try {
    serviceAccount = require('./firebase-key.json');
} catch (err) {
    console.error('❌ Tidak menemukan atau membaca file firebase-key.json:', err.message);
    console.error('   Pastikan file firebase-key.json ada di folder Laundry Backend dan berformat JSON layanan akun (service account).');
    process.exit(1);
}

if (!serviceAccount || serviceAccount.type !== 'service_account' || !serviceAccount.client_email || !serviceAccount.private_key) {
    console.error('❌ File firebase-key.json tidak valid atau bukan service account key.');
    console.error('   Unduh ulang private key dari Firebase Console → Project settings → Service accounts → Generate new private key.');
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
    });
    db = admin.firestore();
    console.log(`✅ Firebase berhasil diinisialisasi sebagai ${serviceAccount.client_email} (project: ${serviceAccount.project_id}).`);
} catch (initErr) {
    console.error('❌ Gagal inisialisasi Firebase:', initErr);
    process.exit(1);
}

// ==========================================
// 2. Inisialisasi WhatsApp Client
// ==========================================
let client;
const whatsappSessionDir = path.join(__dirname, '.wwebjs_auth');

let waReady = false;
let latestWhatsAppAuthQR = null;
let waState = 'INITIALIZING';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function restartWhatsAppClient(reason, clearSession = false) {
    console.log(`🔄 Restarting WhatsApp client (${reason})...`);
    waReady = false;
    waState = reason;
    latestWhatsAppAuthQR = null;

    if (client) {
        try {
            await client.destroy(true);
            console.log('✅ WhatsApp client destroyed.');
        } catch (destroyError) {
            console.warn('⚠️ Error destroying WhatsApp client during restart:', destroyError.message);
        }
        client = null;
    }

    if (clearSession && fs.existsSync(whatsappSessionDir)) {
        try {
            fs.rmSync(whatsappSessionDir, { recursive: true, force: true });
            console.log('🧹 WhatsApp session folder removed.');
        } catch (rmError) {
            console.warn('⚠️ Gagal menghapus folder session WhatsApp:', rmError.message);
        }
    }

    await initializeWhatsAppClient();
}

async function initializeWhatsAppClient(retry = 0) {
    const sessionDir = retry === 0
        ? whatsappSessionDir
        : path.join(__dirname, `.wwebjs_auth_retry_${retry}`);

    if (retry > 0) {
        console.warn(`⚠️ Using fallback WhatsApp session directory: ${sessionDir}`);
    }

    client = new Client({
        authStrategy: new LocalAuth({ clientId: 'laundry-app', dataPath: sessionDir }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    waReady = false;
    latestWhatsAppAuthQR = null;
    waState = 'INITIALIZING';

    registerWhatsAppHandlers(client);

    try {
        await client.initialize();
    } catch (initError) {
        console.error('❌ initializeWhatsAppClient failed:', initError.message);

        if (retry === 0 && /already running for/i.test(initError.message)) {
            console.warn('⚠️ Detected leftover browser session lock. Removing session folder and retrying initialization...');
            try {
                if (fs.existsSync(whatsappSessionDir)) {
                    fs.rmSync(whatsappSessionDir, { recursive: true, force: true });
                    console.log('🧹 Leftover WhatsApp session folder removed before retry.');
                }
            } catch (removeError) {
                console.warn('⚠️ Gagal menghapus folder session saat retry init:', removeError.message);
            }
            await sleep(500);
            return initializeWhatsAppClient(retry + 1);
        }

        if (retry === 1 && /already running for/i.test(initError.message)) {
            console.warn('⚠️ Browser lock persists. Falling back to a fresh WhatsApp session directory.');
            await sleep(500);
            return initializeWhatsAppClient(retry + 1);
        }

        throw initError;
    }
}

function registerWhatsAppHandlers(instance) {
    instance.on('qr', qr => {
        latestWhatsAppAuthQR = qr;
        waState = 'AWAITING_AUTH';
        waReady = false;
        console.log('📷 WhatsApp perlu autentikasi. Buka dashboard kasir dan scan QR jika status belum READY.');
    });

    instance.on('authenticated', session => {
        latestWhatsAppAuthQR = null;
        waState = 'AUTHENTICATED';
        console.log('✅ WhatsApp berhasil diautentikasi. Session disimpan.');
    });

    instance.on('ready', () => {
        waReady = true;
        waState = 'READY';
        console.log('✅ WhatsApp Client siap mengirim pesan!');
    });

    instance.on('auth_failure', async msg => {
        waReady = false;
        waState = 'AUTH_FAILURE';
        latestWhatsAppAuthQR = null;
        console.error('❌ WhatsApp auth failure:', msg);

        try {
            await restartWhatsAppClient('AUTH_FAILURE', true);
        } catch (restartError) {
            console.error('❌ Gagal restart WhatsApp setelah auth failure:', restartError.message);
        }
    });

    instance.on('disconnected', reason => {
        waReady = false;
        waState = 'DISCONNECTED';
        console.warn('⚠️ WhatsApp client disconnected:', reason);
    });

    instance.on('message_create', async msg => {
        const pesan = msg.body.trim();
        if (pesan.toLowerCase().startsWith('!status')) {
            const parts = pesan.split(' ');
            if (parts.length < 2) {
                return msg.reply('Halo! 🤖 Untuk mengecek status cucianmu, silakan balas dengan format:\n\n*!status <ID_PESANAN>*\n\nContoh: *!status pu8x7ziVY...*');
            }

            const idPesanan = parts[1].trim();
            try {
                const doc = await db.collection('pesanan_laundry').doc(idPesanan).get();
                if (!doc.exists) {
                    return msg.reply(`Maaf, pesanan dengan ID *${idPesanan}* tidak ditemukan di sistem kami. Coba periksa kembali nomor ID yang ada di struk WhatsApp kamu ya! 🙏`);
                }

                const data = doc.data();
                const statusSaatIni = data.status.toUpperCase();
                const iconStatus = statusSaatIni === 'SELESAI' ? '✅' : '⏳';
                const replyPesan = `Halo *${data.nama}*! 🧺✨\n\nBerikut adalah *update* status cucianmu:\n\n🔖 *Layanan:* ${data.layanan}\n⚖️ *Berat:* ${data.berat} kg\n💰 *Total Tagihan:* Rp ${Number(data.totalHarga).toLocaleString('id-ID')}\n\n📍 *STATUS SAAT INI:*\n[ ${iconStatus} *${statusSaatIni}* ]\n\nTerima kasih telah menggunakan layanan FreshPOS!`;
                msg.reply(replyPesan);
            } catch (error) {
                console.error('Error cek status bot:', error);
                msg.reply('Maaf, sedang ada perbaikan sistem sehingga bot tidak bisa mengecek status. Coba beberapa saat lagi ya! 🛠️');
            }
        }
    });
}

initializeWhatsAppClient();

async function sendWhatsAppMessage(number, message, options = {}) {
    if (!waReady) {
        throw new Error('WhatsApp client belum siap. Pastikan WhatsApp terhubung.');
    }

    if (!number) {
        throw new Error('Nomor WhatsApp tidak boleh kosong.');
    }

    let chatId = String(number).trim();
    if (!chatId.includes('@')) {
        let formattedNumber = chatId.replace(/\D/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substring(1);
        }

        if (formattedNumber.length < 8) {
            throw new Error('Nomor WhatsApp tidak valid: terlalu pendek.');
        }

        chatId = `${formattedNumber}@c.us`;
    }

    return client.sendMessage(chatId, message, options);
}

// ==========================================
// FITUR BOT AUTO-REPLY WHATSAPP 🤖
// ==========================================

// ==========================================
// 3. Routing (API Endpoints) Utama
// ==========================================

// Helper: Generate unique 4-digit receipt ID
async function generateUniqueOrderId() {
    let attempts = 0;
    while (attempts < 10) {
        const randomId = String(Math.floor(1000 + Math.random() * 9000));
        const docRef = db.collection('pesanan_laundry').doc(randomId);
        const doc = await docRef.get();
        if (!doc.exists) {
            return randomId;
        }
        attempts++;
    }
    throw new Error('Gagal membuat ID pesanan unik setelah 10 percobaan');
}

// A. Rute Halaman Utama (Kasir)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// A++. WhatsApp auth status and QR page
// A+. Health Check Endpoint
app.get('/api/health', async (req, res) => {
    try {
        await db.collection('pesanan_laundry').limit(1).get();
        const payload = { 
            success: true, 
            message: 'Server, Firebase, dan WhatsApp OK',
            firebase: 'Connected',
            whatsapp: {
                ready: waReady,
                state: waState,
                qrPending: latestWhatsAppAuthQR ? true : false,
                qr: latestWhatsAppAuthQR || null
            },
            time: new Date().toLocaleString('id-ID')
        };
        res.json(payload);
    } catch (error) {
        console.error('❌ [API] Health check failed:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Firebase connection error: ' + error.message,
            firebase: 'Disconnected',
            whatsapp: {
                ready: waReady,
                state: waState,
                qrPending: latestWhatsAppAuthQR ? true : false,
                qr: latestWhatsAppAuthQR || null
            }
        });
    }
});

app.post('/api/reset-wa-session', async (req, res) => {
    try {
        waReady = false;
        waState = 'RESETTING';
        latestWhatsAppAuthQR = null;

        if (client) {
            try {
                await client.destroy(true);
                console.log('✅ WhatsApp client destroyed successfully.');
            } catch (destroyError) {
                console.warn('⚠️ Error destroying WhatsApp client:', destroyError.message);
            }
        }

        if (fs.existsSync(whatsappSessionDir)) {
            fs.rmSync(whatsappSessionDir, { recursive: true, force: true });
            console.log('🧹 WhatsApp session folder removed.');
        }

        await initializeWhatsAppClient();
        res.json({ success: true, message: 'WhatsApp session reset. Silakan scan QR kembali di dashboard.' });
    } catch (error) {
        console.error('❌ [API] Reset WA session failed:', error);
        res.status(500).json({ success: false, message: 'Gagal mereset WhatsApp session: ' + error.message });
    }
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

        // 1. Generate unique 4-digit receipt ID and save to Firebase
        const orderId = await generateUniqueOrderId();
        await db.collection('pesanan_laundry').doc(orderId).set({
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
        
        const pesananBaru = { id: orderId };

        // 2. Format nomor WA
        let formattedNumber = String(noWa).replace(/\D/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substring(1);
        }
        formattedNumber += '@c.us';

        // 3. Siapkan teks informasi diskon & catatan secara kondisional
        let teksDiskon = diskonAktif > 0 ? `\n🏷️ *Diskon:* - Rp ${diskonAktif.toLocaleString('id-ID')}` : '';
        let teksCatatan = (catatanAktif && catatanAktif !== '-' && catatanAktif !== '') ? `\n📝 *Catatan:* ${catatanAktif}` : '';

        // 4. Generate QR code (contains only the order ID) and send Struk Digital via WhatsApp
        const pesanWA = `Halo *${nama}*! 🧺✨\n\nPesanan laundry kamu sudah kami terima dan sedang *DIPROSES*. Berikut detailnya:\n\n🔖 *No. Struk:* ${pesananBaru.id}\n👕 *Layanan:* ${layanan}\n⚖️ *Berat:* ${berat} kg${teksDiskon}${teksCatatan}\n💰 *Total Tagihan:* Rp ${Number(totalHarga).toLocaleString('id-ID')}\n\nTunjukkan QR code ini saat mengambil cucian agar kami dapat memproses lebih cepat. Terima kasih! 🙏`;

        try {
            // Generate QR PNG data URL (we encode just the order id; you can change to a URL if hosted)
            const qrDataUrl = await QRCode.toDataURL(pesananBaru.id, { errorCorrectionLevel: 'M', margin: 2, type: 'image/png', width: 400 });

            // Create MessageMedia from data URL and send with caption (receipt text)
            // Convert data URL to mime + base64
            const matches = qrDataUrl.match(/^data:(.+);base64,(.+)$/);
            if (!matches) throw new Error('Invalid QR Data URL');
            const mimeType = matches[1];
            const base64Data = matches[2];
            const media = new MessageMedia(mimeType, base64Data, `struk-${pesananBaru.id}.png`);

            console.log(`📤 Mengirim WA ke ${formattedNumber} dengan media (mime=${mimeType})`);
            await sendWhatsAppMessage(formattedNumber, media, { caption: pesanWA });
            console.log('✅ WA dengan QR berhasil dikirim.');

            res.json({ success: true, message: 'Pesanan berhasil dibuat dan WA terkirim (dengan QR).', idPesanan: pesananBaru.id });
        } catch (sendError) {
            const waktuSend = new Date().toLocaleString('id-ID');
            const pesanLogSend = `[${waktuSend}] ERROR WA BUAT PESANAN:\n${sendError.stack}\n-----------------------------------\n`;
            fs.appendFileSync('logs.txt', pesanLogSend);
            res.json({ success: true, message: 'Pesanan berhasil dibuat, tetapi WA gagal dikirim: ' + sendError.message, idPesanan: pesananBaru.id });
        }

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
        console.error('❌ [API] Error loading riwayat:', error.message);
        res.status(500).json({ success: false, message: 'Gagal mengambil data riwayat: ' + error.message });
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
        
        try {
            await sendWhatsAppMessage(formattedNumber, pesanSelesai);
            res.json({ success: true, message: 'Status diupdate & WA Selesai terkirim!' });
        } catch (sendError) {
            const waktuSend = new Date().toLocaleString('id-ID');
            const pesanLogSend = `[${waktuSend}] ERROR WA UPDATE STATUS:\n${sendError.stack}\n-----------------------------------\n`;
            fs.appendFileSync('logs.txt', pesanLogSend);
            res.json({ success: true, message: 'Status diupdate, tetapi WA gagal dikirim: ' + sendError.message });
        }
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
        console.error('❌ [API] Error loading dashboard:', error.message);
        res.status(500).json({ success: false, message: 'Gagal memuat data dashboard: ' + error.message });
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

                    try {
                        await sendWhatsAppMessage(noWa, pesanReminder);
                        await db.collection('pesanan_laundry').doc(doc.id).update({
                            reminderTerkirim: true
                        });

                        console.log(`✅ [CRON] Pengingat berhasil terkirim ke ${data.nama}`);
                    } catch (sendError) {
                        const waktuSend = new Date().toLocaleString('id-ID');
                        const pesanLogSend = `[${waktuSend}] ERROR WA CRON REMINDER:\n${sendError.stack}\n-----------------------------------\n`;
                        fs.appendFileSync('logs.txt', pesanLogSend);
                        console.warn(`⚠️ [CRON] Gagal mengirim reminder WA ke ${data.nama}: ${sendError.message}`);
                    }
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

// Verifikasi Firebase koneksi
db.collection('pesanan_laundry').limit(1).get()
  .then(() => console.log('✅ Firebase Database terhubung dan siap'))
  .catch(err => console.error('❌ Firebase Database error:', err.message));

const server = app.listen(PORT, () => {
    console.log(`🚀 Server & Halaman Kasir berjalan di http://localhost:${PORT}`);
    console.log('📝 Log file tersedia di logs.txt');
    const router = app._router || app.router;
    if (router && router.stack) {
        const routes = router.stack
            .filter(layer => layer.route)
            .map(layer => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
        console.log('🔧 Registered routes:', routes);
    } else {
        console.log('🔧 Registered routes: (router not available)');
    }
});

// API: ambil satu pesanan berdasarkan ID
app.get('/api/pesanan/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const doc = await db.collection('pesanan_laundry').doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });
        const data = doc.data();
        res.json({ success: true, data: { id: doc.id, ...data } });
    } catch (err) {
        console.error('❌ [API] Error ambil pesanan:', err.message);
        res.status(500).json({ success: false, message: 'Gagal mengambil pesanan: ' + err.message });
    }
});

// API: tandai pesanan diambil (pickup)
app.post('/api/pickup/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await db.collection('pesanan_laundry').doc(id).update({ status: 'Diambil' });
        res.json({ success: true, message: 'Pesanan ditandai Diambil.' });
    } catch (err) {
        console.error('❌ [API] Error pickup pesanan:', err.message);
        res.status(500).json({ success: false, message: 'Gagal menandai pickup: ' + err.message });
    }
});

// ==========================================
// 8. Penutupan Server yang Aman (Graceful Shutdown)
// ==========================================
process.on('SIGINT', async () => {
    console.log('\n🛑 Mematikan server dengan aman...');
    if (client) {
        try {
            console.log('Menutup sesi WhatsApp...');
            await client.destroy();
            console.log('✅ Sesi WhatsApp berhasil ditutup.');
        } catch (err) {
            console.log('⚠️ Gagal menutup WhatsApp:', err.message);
        }
    }
    process.exit(0);
});