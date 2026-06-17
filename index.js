const express = require('express');
const admin = require('firebase-admin');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const puppeteer = require('puppeteer');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

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

    const browser = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
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
let db;
let serviceAccount;

try {
    if (process.env.FIREBASE_CREDENTIALS) {
        // Running on Render or environment with FIREBASE_CREDENTIALS
        serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://laundry-app-45d4c.firebaseio.com",
            projectId: serviceAccount.project_id
        });
        db = admin.firestore();
        console.log('✅ Firebase berhasil diinisialisasi via FIREBASE_CREDENTIALS.');
    } else if (process.env.FIREBASE_CONFIG_JSON) {
        // Initialize from environment variable (useful for Vercel)
        serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG_JSON);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://laundry-app-45d4c.firebaseio.com",
            projectId: serviceAccount.project_id
        });
        db = admin.firestore();
        console.log('✅ Firebase berhasil diinisialisasi via FIREBASE_CONFIG_JSON.');
    } else {
        // Fallback for local development using firebase-key.json
        serviceAccount = require('./firebase-key.json');
        if (!serviceAccount || serviceAccount.type !== 'service_account' || !serviceAccount.client_email || !serviceAccount.private_key) {
            throw new Error('File firebase-key.json tidak valid atau bukan service account key.');
        }
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://laundry-app-45d4c.firebaseio.com",
            projectId: serviceAccount.project_id
        });
        db = admin.firestore();
        console.log('✅ Firebase berhasil diinisialisasi via file lokal.');
    }
} catch (err) {
    console.error('❌ Gagal inisialisasi Firebase:', err.message || err);
    process.exit(1);
}

// ==========================================
// 2. Inisialisasi WhatsApp Client
// ==========================================
const whatsappSessionDir = path.join(__dirname, '.wwebjs_auth');
let client;

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
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
        // 1. Hilangkan semua karakter non-angka (+, -, spasi)
        let formattedNumber = chatId.replace(/\D/g, '');

        // 2. JIKA diawali '0', ubah jadi '62' (Contoh: 0812 -> 62812)
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substring(1);
        }
        // 3. JIKA langsung diawali '8' (seperti yang kamu lakukan tadi), tambahkan '62' di depannya
        else if (formattedNumber.startsWith('8')) {
            formattedNumber = '62' + formattedNumber;
        }
        // JIKA user ngetik '628...', kode akan melewatinya dengan aman tanpa merusak nomor

        if (formattedNumber.length < 8) {
            throw new Error('Nomor WhatsApp tidak valid: terlalu pendek.');
        }

        // 4. Hasil akhirnya dijamin selalu valid, misal: 6282233310460@c.us
        chatId = `${formattedNumber}@c.us`;
    }

    return client.sendMessage(chatId, message, options);
}

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

    // ==========================================
    // 🛡️ BACKEND VALIDATION (Keamanan Server)
    // ==========================================

    // Validasi Nama
    const regexAlfabet = /^[A-Za-z.'\-\s]+$/;
    if (!nama || nama.trim().length < 3 || nama.length > 50 || !regexAlfabet.test(nama)) {
        return res.status(400).json({ success: false, message: 'Validasi Gagal: Nama minimal 3, maksimal 50 karakter (huruf, spasi, ., \', - saja).' });
    }

    // Validasi No WA
    const regexAngka = /^\d+$/;
    const strWa = String(noWa);
    if (!strWa || strWa.length < 9 || strWa.length > 13 || !regexAngka.test(strWa)) {
        return res.status(400).json({ success: false, message: 'Validasi Gagal: Nomor WA harus angka (9 - 13 digit).' });
    }

    // Validasi Catatan
    if (catatan && String(catatan).length > 200) {
        return res.status(400).json({ success: false, message: 'Validasi Gagal: Catatan maksimal 200 karakter.' });
    }

    // Validasi Logika Tambahan
    const beratNum = Number(berat);
    const totalHargaNum = Number(totalHarga);
    const diskonNum = Number(diskon) || 0;
    if (isNaN(beratNum) || beratNum <= 0 || beratNum > 100) {
        return res.status(400).json({ success: false, message: 'Validasi Gagal: Berat cucian tidak valid.' });
    }
    if (isNaN(totalHargaNum) || totalHargaNum < 0) {
        return res.status(400).json({ success: false, message: 'Validasi Gagal: Total Harga tidak valid.' });
    }
    if (diskonNum > totalHargaNum && totalHargaNum > 0) {
        return res.status(400).json({ success: false, message: 'Validasi Gagal: Diskon melebihi total harga.' });
    }

    // Validasi Total Harga harus sesuai harga layanan resmi x berat - diskon.
    // Ini mencegah permintaan langsung ke API (bypass frontend) untuk memanipulasi tagihan.
    try {
        const hargaDoc = await db.collection('pengaturan').doc('harga_layanan').get();
        const hargaLayananData = hargaDoc.exists ? hargaDoc.data() : { "Cuci Komplit": 6000, "Cuci Kering": 5000, "Setrika Saja": 4000 };
        const hargaSatuan = hargaLayananData[layanan];

        if (hargaSatuan === undefined) {
            return res.status(400).json({ success: false, message: 'Validasi Gagal: Jenis layanan tidak dikenali.' });
        }

        const totalSeharusnya = Math.max(0, (beratNum * hargaSatuan) - diskonNum);
        if (Math.abs(totalHargaNum - totalSeharusnya) > 1) {
            return res.status(400).json({ success: false, message: `Validasi Gagal: Total Harga tidak sesuai hitungan sistem (seharusnya Rp ${totalSeharusnya.toLocaleString('id-ID')}).` });
        }
    } catch (priceCheckError) {
        return res.status(500).json({ success: false, message: 'Gagal memvalidasi harga layanan.' });
    }

    try {
        const waktuSekarang = new Date();
        const diskonAktif = Number(diskon) || 0;
        const catatanAktif = catatan || '-';
        const teksDiskon = diskonAktif > 0 ? `\n💸 *Diskon:* Rp ${diskonAktif.toLocaleString('id-ID')}` : '';
        const teksCatatan = catatanAktif !== '-' ? `\n📝 *Catatan:* ${catatanAktif}` : '';

        // 1. Generate unique 4-digit receipt ID and save to Firebase
        const orderId = await generateUniqueOrderId();
        await db.collection('pesanan_laundry').doc(orderId).set({
            nama,
            noWa: strWa,
            berat: Number(berat),
            layanan,
            totalHarga: Number(totalHarga),
            diskon: diskonAktif,
            catatan: catatanAktif,
            status: 'Diproses',
            tanggal: waktuSekarang,
            reminderTerkirim: false
        });

        const pesananBaru = { id: orderId };

        // 2. Format nomor WA
        let formattedNumber = strWa;
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '62' + formattedNumber.substring(1);
        }
        formattedNumber += '@c.us';

        // 3. Generate QR Code + Struk gambar & PDF
        const strukturData = { nama, noWa: strWa, berat, layanan, totalHarga: Number(totalHarga), diskon: diskonAktif, catatan: catatanAktif };
        const { pngBuffer } = await generateStrukMedia(strukturData, pesananBaru.id);

        // 4. Generate QR code (contains only the order ID) and send Struk Digital via WhatsApp
        const pesanWA = `Halo *${nama}*! 🧺✨\n\nPesanan laundry kamu sudah kami terima dan sedang *DIPROSES*. Berikut detailnya:\n\n🔖 *No. Struk:* ${pesananBaru.id}\n👕 *Layanan:* ${layanan}\n⚖️ *Berat:* ${berat} kg${teksDiskon}${teksCatatan}\n💰 *Total Tagihan:* Rp ${Number(totalHarga).toLocaleString('id-ID')}\n\nTunjukkan QR code ini saat mengambil cucian agar kami dapat memproses lebih cepat. Terima kasih! 🙏`;

        try {
            // 5. Kirim gambar Struk via WhatsApp (Hanya SATU pengiriman pesan)
            const pngBase64 = pngBuffer.toString('base64');
            const mediaStruk = new MessageMedia('image/png', pngBase64, `struk-${pesananBaru.id}.png`);

            console.log(`📤 Mengirim WA Struk Digital ke ${formattedNumber}`);
            await sendWhatsAppMessage(formattedNumber, mediaStruk, { caption: pesanWA });
            console.log('✅ WA Struk Digital berhasil dikirim.');

            // Beri 'return' agar proses berhenti dan tidak error headers terkirim dua kali
            return res.json({ success: true, message: 'Pesanan berhasil dibuat dan WA Struk terkirim!', idPesanan: pesananBaru.id });

        } catch (sendError) {
            const waktuSend = new Date().toLocaleString('id-ID');
            const pesanLogSend = `[${waktuSend}] ERROR WA BUAT PESANAN:\n${sendError.stack}\n-----------------------------------\n`;
            fs.appendFileSync('logs.txt', pesanLogSend);
            console.error('❌ Gagal kirim WA:', sendError.message);

            // Lapor sukses ke database meskipun WA gagal terkirim
            return res.json({ success: true, message: 'Pesanan dibuat, tapi WA gagal dikirim: ' + sendError.message, idPesanan: pesananBaru.id });
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
        // Update status to 'Siap Diambil' (ready for pickup)
        await db.collection('pesanan_laundry').doc(idPesanan).update({
            status: 'Siap Diambil'
        });

        // Optionally notify customer via WhatsApp that laundry is ready for pickup
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

        const pesanReady = `Halo *${nama}*! 🧺✨\n\nPesanan dengan No. Struk *${idPesanan}* telah selesai dicuci dan *SIAP DIAMBIL* di toko kami. Silakan datang membawa struk/QR untuk pengambilan.\n\nTerima kasih!`;

        try {
            await sendWhatsAppMessage(formattedNumber, pesanReady);
            res.json({ success: true, message: 'Status diupdate menjadi Siap Diambil & notifikasi WA terkirim.' });
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


// New endpoint: pickup confirmation via QR scan
app.post('/api/pickup/:id', async (req, res) => {
    const idPesanan = req.params.id;
    try {
        const docRef = db.collection('pesanan_laundry').doc(idPesanan);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan.' });

        const data = doc.data();
        const currentStatus = (data.status || '').toLowerCase();

        // Only allow pickup if currently ready for pickup
        if (!(currentStatus === 'siap diambil' || currentStatus === 'siap')) {
            return res.status(400).json({ success: false, message: `Pesanan saat ini bukan 'Siap Diambil' (status: ${data.status}).` });
        }

        await docRef.update({ status: 'Sudah Diambil', pickupAt: new Date().toISOString(), reminderTerkirim: true });

        // Notify customer (optional) that their order has been picked up
        if (data.noWa) {
            try {
                let formattedNumber = String(data.noWa).replace(/\D/g, '');
                if (formattedNumber.startsWith('0')) formattedNumber = '62' + formattedNumber.substring(1);
                if (formattedNumber.length >= 8) {
                    formattedNumber += '@c.us';
                    const pesanPicked = `Terima kasih, pesanan laundry ID ${idPesanan} telah berhasil diambil!`;
                    await sendWhatsAppMessage(formattedNumber, pesanPicked);
                }
            } catch (waErr) {
                const waktuSend = new Date().toLocaleString('id-ID');
                fs.appendFileSync('logs.txt', `[${waktuSend}] ERROR WA PICKUP:\n${waErr.stack}\n-----------------------------------\n`);
            }
        }

        res.json({ success: true, message: 'Status diupdate: Sudah Diambil' });
    } catch (err) {
        const waktu = new Date().toLocaleString('id-ID');
        fs.appendFileSync('logs.txt', `[${waktu}] ERROR PICKUP:\n${err.stack}\n-----------------------------------\n`);
        res.status(500).json({ success: false, message: 'Gagal memproses pickup: ' + err.message });
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
// SHIFT MANAGEMENT API
// ==========================================

// Helper: serialize Firestore Timestamp → ISO string
function serializeTimestamp(ts) {
    if (!ts) return null;
    if (ts._seconds) return new Date(ts._seconds * 1000).toISOString();
    if (ts instanceof Date) return ts.toISOString();
    return ts;
}

// Helper: extract zero-padded date/time parts from a Date
function getDateParts(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return { d, mo, y, h, min };
}

// GET /api/shift/status
app.get('/api/shift/status', async (req, res) => {
    try {
        const snapshot = await db.collection('shift_records')
            .where('status', '==', 'OPEN')
            .limit(1)
            .get();
        if (snapshot.empty) {
            return res.json({ success: true, hasActiveShift: false, shift: null });
        }
        const doc = snapshot.docs[0];
        const data = doc.data();
        const shift = { id: doc.id, ...data, startTime: serializeTimestamp(data.startTime) };
        return res.json({ success: true, hasActiveShift: true, shift });
    } catch (error) {
        console.error('❌ [SHIFT] Error cek status shift:', error.message);
        res.status(500).json({ success: false, message: 'Gagal mengambil status shift: ' + error.message });
    }
});

// POST /api/shift/open
app.post('/api/shift/open', async (req, res) => {
    try {
        const cashierName = String(req.body.cashierName || '').trim();
        const startingCash = req.body.startingCash;
        if (!cashierName) {
            return res.status(400).json({ success: false, message: 'Nama kasir tidak boleh kosong.' });
        }
        const startingCashNum = Number(startingCash);
        if (isNaN(startingCashNum) || startingCashNum < 0) {
            return res.status(400).json({ success: false, message: 'Modal awal kas tidak valid.' });
        }
        // Cek shift aktif secara global
        const existingSnap = await db.collection('shift_records')
            .where('status', '==', 'OPEN').limit(1).get();
        if (!existingSnap.empty) {
            const existing = existingSnap.docs[0].data();
            return res.status(409).json({
                success: false,
                message: `Shift milik ${existing.cashierName} masih aktif. Tutup shift tersebut terlebih dahulu.`
            });
        }
        // ID sementara: NamaKasir_DDMMYYYY_HHMM
        const now = new Date();
        const { d, mo, y, h, min } = getDateParts(now);
        const cleanName = cashierName.replace(/[^a-zA-Z0-9]/g, '_');
        const openShiftDocId = `${cleanName}_${d}${mo}${y}_${h}${min}`;
        await db.collection('shift_records').doc(openShiftDocId).set({
            cashierName, startingCash: startingCashNum,
            startTime: now, endTime: null, status: 'OPEN',
            totalSalesDuringShift: 0, expectedEndingCash: 0, actualEndingCash: 0, discrepancy: 0
        });
        console.log(`✅ [SHIFT] Shift dibuka oleh ${cashierName} (ID: ${openShiftDocId}), modal awal: Rp ${startingCashNum.toLocaleString('id-ID')}`);
        return res.json({
            success: true,
            message: `Shift berhasil dibuka! Modal awal: Rp ${startingCashNum.toLocaleString('id-ID')}`,
            shift: { id: openShiftDocId, cashierName, startTime: now.toISOString(), status: 'OPEN', startingCash: startingCashNum }
        });
    } catch (error) {
        console.error('❌ [SHIFT] Error buka shift:', error.message);
        res.status(500).json({ success: false, message: 'Gagal membuka shift: ' + error.message });
    }
});

// POST /api/shift/close
app.post('/api/shift/close', async (req, res) => {
    try {
        const actualEndingCashNum = Number(req.body.actualEndingCash);
        if (isNaN(actualEndingCashNum) || actualEndingCashNum < 0) {
            return res.status(400).json({ success: false, message: 'Jumlah kas fisik tidak valid.' });
        }
        // Cari shift OPEN aktif secara global
        const shiftSnap = await db.collection('shift_records')
            .where('status', '==', 'OPEN').limit(1).get();
        if (shiftSnap.empty) {
            return res.status(404).json({ success: false, message: 'Tidak ada shift aktif yang ditemukan.' });
        }
        const activeShiftDoc = shiftSnap.docs[0];
        const activeShiftData = activeShiftDoc.data();
        // Rekonstruksi startTime
        let startTimeDate;
        if (activeShiftData.startTime?._seconds) {
            startTimeDate = new Date(activeShiftData.startTime._seconds * 1000);
        } else if (activeShiftData.startTime instanceof Date) {
            startTimeDate = activeShiftData.startTime;
        } else {
            startTimeDate = new Date(activeShiftData.startTime);
        }
        // Hitung total penjualan selama shift
        const endTime = new Date();
        const ordersSnapshot = await db.collection('pesanan_laundry')
            .where('tanggal', '>=', startTimeDate)
            .where('tanggal', '<=', endTime)
            .get();
        let totalSalesDuringShift = 0;
        ordersSnapshot.forEach(doc => { totalSalesDuringShift += Number(doc.data().totalHarga) || 0; });
        const startingCash = Number(activeShiftData.startingCash) || 0;
        const expectedEndingCash = startingCash + totalSalesDuringShift;
        const discrepancy = actualEndingCashNum - expectedEndingCash;
        // ID final: NamaKasir_DDMMYYYY_HHMMBuka_HHMMTutup
        const { h: closeH, min: closeMin } = getDateParts(endTime);
        const finalShiftDocId = `${activeShiftDoc.id}_${closeH}${closeMin}`;
        // Tulis dokumen final baru
        await db.collection('shift_records').doc(finalShiftDocId).set({
            ...activeShiftData,
            startTime: startTimeDate,
            endTime,
            status: 'CLOSED',
            actualEndingCash: actualEndingCashNum,
            totalSalesDuringShift,
            expectedEndingCash,
            discrepancy
        });
        // Hapus dokumen sementara
        await db.collection('shift_records').doc(activeShiftDoc.id).delete();
        console.log(`✅ [SHIFT] Shift ditutup | ${activeShiftDoc.id} → ${finalShiftDocId} | Selisih: Rp ${discrepancy.toLocaleString('id-ID')}`);
        return res.json({
            success: true,
            message: 'Shift berhasil ditutup.',
            summary: {
                shiftId: finalShiftDocId,
                cashierName: activeShiftData.cashierName,
                startTime: startTimeDate.toISOString(),
                endTime: endTime.toISOString(),
                startingCash, totalSalesDuringShift, expectedEndingCash,
                actualEndingCash: actualEndingCashNum, discrepancy
            }
        });
    } catch (error) {
        console.error('❌ [SHIFT] Error tutup shift:', error.message);
        res.status(500).json({ success: false, message: 'Gagal menutup shift: ' + error.message });
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



// ==========================================
// 8. Penutupan Server yang Aman (Graceful Shutdown)
// ==========================================
const gracefulShutdown = async (signal) => {
    console.log(`\n🛑 Menerima sinyal ${signal}. Mematikan server dengan aman...`);
    try {
        if (client) {
            console.log('Menutup sesi WhatsApp...');
            await client.destroy();
            console.log('✅ Sesi WhatsApp berhasil ditutup.');
        }
    } catch (error) {
        console.error('⚠️ Gagal menutup sesi WhatsApp:', error.message);
    } finally {
        process.exit(0);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));