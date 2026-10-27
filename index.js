const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } = require('@whiskeysockets/baileys');
const express = require('express');
const multer = require('multer');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();
const logger = pino({ level: 'silent' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = path.join(__dirname, 'uploads');
const sessionsRoot = path.join(__dirname, 'sessions');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(sessionsRoot)) fs.mkdirSync(sessionsRoot, { recursive: true });

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 200 * 1024 * 1024 }
});

let activeSessions = {};

async function createBotSession(botNumber, reqResCallback) {
    const cleanedNumber = String(botNumber || '').replace(/[^0-9]/g, '');
    if (!cleanedNumber || cleanedNumber.length < 10) {
        if (reqResCallback) reqResCallback({ success: false, message: 'Nomor tidak valid. Format: 628xxxxxxxxxx' });
        return;
    }

    const sessionDir = path.join(sessionsRoot, `session_${cleanedNumber}`);

    if (activeSessions[cleanedNumber] && activeSessions[cleanedNumber].isConnected) {
        if (reqResCallback) reqResCallback({ success: true, message: 'Bot sudah terhubung!' });
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        markOnlineOnConnect: true
    });

    if (!activeSessions[cleanedNumber]) {
        activeSessions[cleanedNumber] = {
            sock,
            isConnected: false,
            pairingCode: null,
            sessionDir,
            contacts: new Set()
        };
    } else {
        activeSessions[cleanedNumber].sock = sock;
    }

    const sessionData = activeSessions[cleanedNumber];
    sessionData.contacts.add(`${cleanedNumber}@s.whatsapp.net`);

    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
        if (contacts) {
            for (const c of contacts) {
                if (c.id && c.id.endsWith('@s.whatsapp.net')) {
                    sessionData.contacts.add(jidNormalizedUser(c.id));
                }
            }
        }
        if (chats) {
            for (const ch of chats) {
                if (ch.id && ch.id.endsWith('@s.whatsapp.net')) {
                    sessionData.contacts.add(jidNormalizedUser(ch.id));
                }
            }
        }
        console.log(`[${cleanedNumber}] Kontak tersimpan untuk Status: ${sessionData.contacts.size} nomor`);
    });

    sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            if (c.id && c.id.endsWith('@s.whatsapp.net')) {
                sessionData.contacts.add(jidNormalizedUser(c.id));
            }
        }
    });

    sock.ev.on('contacts.update', (updates) => {
        for (const c of updates) {
            if (c.id && c.id.endsWith('@s.whatsapp.net')) {
                sessionData.contacts.add(jidNormalizedUser(c.id));
            }
        }
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanedNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                sessionData.pairingCode = formattedCode;
                console.log(`[${cleanedNumber}] Pairing code: ${formattedCode}`);
                if (reqResCallback) reqResCallback({ success: true, pairingCode: formattedCode });
            } catch (err) {
                console.error(`[${cleanedNumber}] Pairing error:`, err.message);
                if (reqResCallback) reqResCallback({ success: false, message: err.message });
            }
        }, 4000);
    } else {
        if (reqResCallback) reqResCallback({ success: true, message: 'Menghubungkan sesi...' });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            sessionData.isConnected = false;
            if (shouldReconnect) {
                setTimeout(() => createBotSession(cleanedNumber), 3000);
            }
        } else if (connection === 'open') {
            sessionData.isConnected = true;
            sessionData.pairingCode = null;
            if (sock.user && sock.user.id) {
                sessionData.contacts.add(jidNormalizedUser(sock.user.id));
            }
            console.log(`✅ Bot ${cleanedNumber} Terhubung!`);
        }
    });
}

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WA Auto-Forward Status HD</title>
    <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 16px; }
        .card { background: #1e293b; width: 100%; max-width: 440px; padding: 24px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); border: 1px solid #334155; }
        h2 { margin-top: 0; font-size: 20px; text-align: center; color: #38bdf8; }
        .box { background: #0f172a; padding: 14px; border-radius: 10px; margin-bottom: 16px; border: 1px solid #334155; font-size: 13px; }
        .badge-on { color: #4ade80; font-weight: bold; }
        .badge-off { color: #facc15; font-weight: bold; }
        .pairing-code { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; margin: 8px 0; display: block; text-align: center; }
        input[type="text"], textarea { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; margin-bottom: 10px; font-size: 14px; }
        .upload-area { border: 2px dashed #475569; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 12px; cursor: pointer; display: block; }
        input[type="file"] { display: none; }
        button { width: 100%; padding: 13px; background: #0284c7; color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        button:hover { background: #0369a1; }
        button:disabled { background: #475569; cursor: not-allowed; }
        .btn-sec { background: #334155; margin-bottom: 10px; }
        .checkbox-container { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 14px; cursor: pointer; }
        #fileName { margin-top: 6px; font-size: 12px; color: #94a3b8; word-break: break-all; }
        #notif { margin-top: 14px; text-align: center; font-size: 13px; font-weight: 500; line-height: 1.5; }
        small.hint { color: #94a3b8; display: block; margin-top: -6px; margin-bottom: 10px; font-size: 11px; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🚀 Bot WA & Auto-Forward Status</h2>
        
        <div class="box">
            <label><b>1. Nomor Bot / Nomor Kamu (Awali 62):</b></label>
            <input type="text" id="botNumberInput" placeholder="Contoh: 6285196971126" oninput="syncNumber(this.value)">
            <button type="button" class="btn-sec" onclick="connectBot()">🔗 Hubungkan / Cek Status Bot</button>
            <div id="botStatusArea" style="margin-top: 8px; text-align: center;">Masukkan nomor WA kamu di atas.</div>
        </div>

        <form id="uploadForm">
            <div class="box">
                <label><b>2. Nomor Tujuan Chat (Otomatis Nomor Sendiri):</b></label>
                <input type="text" id="targetNumber" name="targetNumber" placeholder="Contoh: 6285196971126" required>
                <small class="hint">*Bot akan mengirim video ke nomor ini dulu, lalu langsung meneruskannya ke Status WA.</small>
            </div>

            <label class="upload-area" for="mediaInput">
                📁 <b>Pilih Foto / Video HD (Hingga 200MB)</b>
                <div id="fileName">Belum ada file dipilih</div>
                <input type="file" id="mediaInput" name="media" accept="image/*,video/*" required>
            </label>

            <input type="text" name="caption" placeholder="Tulis caption status (opsional)...">

            <label class="checkbox-container">
                <input type="checkbox" name="autoStatus" value="true" checked>
                <span>🔄 <b>Auto-Forward:</b> Langsung teruskan video dari chat ke Status WhatsApp</span>
            </label>

            <div class="box">
                <label><b>Tambahan Nomor Penonton Status (Opsional):</b></label>
                <input type="text" name="extraContacts" placeholder="Contoh: 62812xxx, 62857xxx">
                <small class="hint">*Secara otomatis dikirim ke kontak yang tersinkronisasi. Isi ini jika ada nomor teman tertentu yang wajib melihat statusmu.</small>
            </div>

            <button type="submit" id="submitBtn">Kirim ke Chat ➔ Teruskan ke Status</button>
        </form>
        <div id="notif"></div>
    </div>

    <script>
        const mediaInput = document.getElementById('mediaInput');
        const fileName = document.getElementById('fileName');
        const notif = document.getElementById('notif');
        let statusInterval;

        function syncNumber(val) {
            document.getElementById('targetNumber').value = val;
        }

        mediaInput.addEventListener('change', () => {
            if (mediaInput.files.length > 0) {
                const f = mediaInput.files[0];
                fileName.innerText = f.name + ' (' + (f.size / (1024 * 1024)).toFixed(2) + ' MB)';
            }
        });

        async function connectBot() {
            const num = document.getElementById('botNumberInput').value.trim();
            if (!num) { alert('Masukkan nomor bot terlebih dahulu!'); return; }
            
            document.getElementById('botStatusArea').innerHTML = '⏳ Memeriksa sesi / meminta kode...';
            const res = await fetch('/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botNumber: num })
            });
            const data = await res.json();
            if(data.success) {
                pollStatus(num);
            } else {
                alert('Gagal: ' + data.message);
            }
        }

        async function pollStatus(num) {
            if (statusInterval) clearInterval(statusInterval);
            statusInterval = setInterval(async () => {
                const res = await fetch('/status?botNumber=' + num);
                const data = await res.json();
                const area = document.getElementById('botStatusArea');
                if (data.connected) {
                    area.innerHTML = 'Status Bot (' + num + '): <span class="badge-on">● Terhubung</span><br><small>Kontak Status Tersimpan: ' + data.contactCount + ' nomor</small>';
                    clearInterval(statusInterval);
                } else {
                    area.innerHTML = 'Status Bot: <span class="badge-off">● Belum Tertaut</span>' +
                        (data.pairingCode ? '<span class="pairing-code">' + data.pairingCode + '</span><small>Masukkan kode ini di Perangkat Tertaut WA</small>' : '<br><small>Menyiapkan koneksi...</small>');
                }
            }, 2500);
        }

        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const botNum = document.getElementById('botNumberInput').value.trim();
            if (!botNum) { alert('Masukkan nomor bot di bagian atas!'); return; }
            if (!mediaInput.files.length) return;

            const formData = new FormData(e.target);
            formData.append('botNumber', botNum);

            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.innerText = '⏳ 1/2 Mengirim ke Chat & Meneruskan ke Status...';
            notif.innerText = '';

            try {
                const res = await fetch('/send', { method: 'POST', body: formData });
                const result = await res.json();
                if (result.success) {
                    notif.style.color = '#4ade80';
                    notif.innerText = result.message;
                    e.target.reset();
                    syncNumber(botNum);
                    fileName.innerText = 'Belum ada file dipilih';
                } else {
                    notif.style.color = '#f87171';
                    notif.innerText = '❌ Gagal: ' + result.message;
                }
            } catch (err) {
                notif.style.color = '#f87171';
                notif.innerText = '❌ Kesalahan jaringan saat mengunggah.';
            } finally {
                btn.disabled = false;
                btn.innerText = 'Kirim ke Chat ➔ Teruskan ke Status';
            }
        });
    </script>
</body>
</html>
    `);
});

app.post('/connect', (req, res) => {
    const { botNumber } = req.body;
    if (!botNumber) return res.status(400).json({ success: false, message: 'Nomor bot wajib diisi.' });

    let responded = false;
    const reply = (payload) => {
        if (responded) return;
        responded = true;
        res.json(payload);
    };

    setTimeout(() => {
        if (!responded) reply({ success: true, message: 'Sesi dibuat. Cek status untuk kode pairing.' });
    }, 20000);

    createBotSession(botNumber, reply).catch(err => {
        reply({ success: false, message: err.message });
    });
});

app.get('/status', (req, res) => {
    const cleaned = (req.query.botNumber || '').replace(/[^0-9]/g, '');
    if (!cleaned || !activeSessions[cleaned]) {
        return res.json({ connected: false, pairingCode: null, contactCount: 0 });
    }
    res.json({
        connected: activeSessions[cleaned].isConnected,
        pairingCode: activeSessions[cleaned].pairingCode,
        contactCount: activeSessions[cleaned].contacts ? activeSessions[cleaned].contacts.size : 1
    });
});

app.post('/send', upload.single('media'), async (req, res) => {
    const { botNumber, targetNumber, caption, autoStatus, extraContacts } = req.body;
    const cleanedBot = (botNumber || '').replace(/[^0-9]/g, '');

    if (!cleanedBot || !activeSessions[cleanedBot] || !activeSessions[cleanedBot].isConnected) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ success: false, message: 'Bot belum terhubung! Klik tombol Hubungkan terlebih dahulu.' });
    }

    if (!req.file || !targetNumber) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ success: false, message: 'File atau nomor tujuan belum lengkap.' });
    }

    const session = activeSessions[cleanedBot];
    const sock = session.sock;
    const filePath = req.file.path;
    const mime = req.file.mimetype || '';
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const cleanTarget = targetNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

    try {
        const isVideo = mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm'].includes(ext);
        const isImage = mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

        if (!isVideo && !isImage) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'Format file harus berupa Foto atau Video!' });
        }

        const mediaBuffer = fs.readFileSync(filePath);

        // TAHAP 1: kirim ke nomor sendiri (HD)
        let sentMsg = null;
        try {
            if (isVideo) {
                sentMsg = await sock.sendMessage(cleanTarget, {
                    video: mediaBuffer,
                    mimetype: 'video/mp4',
                    caption: caption || '',
                    gifPlayback: false
                });
            } else {
                sentMsg = await sock.sendMessage(cleanTarget, {
                    image: mediaBuffer,
                    caption: caption || ''
                });
            }
            console.log(`[${cleanedBot}] Terkirim ke chat: ${cleanTarget}`);
        } catch (chatErr) {
            console.error(`[${cleanedBot}] Gagal kirim ke chat:`, chatErr.message);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(500).json({ success: false, message: 'Gagal kirim ke chat: ' + chatErr.message });
        }

        // TAHAP 2: kirim LANGSUNG ke Status (bukan hanya forward)
        let statusSuccess = false;
        let statusError = null;

        if (autoStatus === 'true') {
            try {
                const jidList = new Set();
                if (session.contacts && session.contacts.size) {
                    for (const j of session.contacts) jidList.add(j);
                }
                jidList.add(cleanTarget);
                if (sock.user && sock.user.id) {
                    jidList.add(jidNormalizedUser(sock.user.id));
                }
                if (extraContacts) {
                    for (const ex of String(extraContacts).split(',')) {
                        const num = ex.replace(/[^0-9]/g, '');
                        if (num.length > 8) jidList.add(num + '@s.whatsapp.net');
                    }
                }

                let finalJidArray = Array.from(jidList).filter(j => j && j.endsWith('@s.whatsapp.net'));
                if (finalJidArray.length === 0 && sock.user?.id) {
                    finalJidArray = [jidNormalizedUser(sock.user.id)];
                }

                console.log(`[${cleanedBot}] Kirim status ke ${finalJidArray.length} jid`);

                if (isVideo) {
                    await sock.sendMessage(
                        'status@broadcast',
                        {
                            video: mediaBuffer,
                            mimetype: 'video/mp4',
                            caption: caption || ''
                        },
                        {
                            statusJidList: finalJidArray,
                            broadcast: true
                        }
                    );
                } else {
                    await sock.sendMessage(
                        'status@broadcast',
                        {
                            image: mediaBuffer,
                            caption: caption || ''
                        },
                        {
                            statusJidList: finalJidArray,
                            broadcast: true
                        }
                    );
                }

                statusSuccess = true;
                console.log(`[${cleanedBot}] Status berhasil diupload`);
            } catch (err1) {
                statusError = err1.message || String(err1);
                console.error(`[${cleanedBot}] Gagal kirim status langsung:`, statusError);

                // cadangan: coba forward
                if (sentMsg) {
                    try {
                        const jidList = new Set(session.contacts || []);
                        jidList.add(cleanTarget);
     
