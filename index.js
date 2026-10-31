const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require('@whiskeysockets/baileys');
const express = require('express');
const multer = require('multer');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const app = express();
const logger = pino({ level: 'silent' });

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Gunakan folder /tmp agar aman dari batasan Read-Only server Deplexo
const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 200 * 1024 * 1024 }
});

let activeSessions = {};

async function createBotSession(botNumber, reqResCallback) {
    const cleanedNumber = botNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(os.tmpdir(), 'sessions', 'session_' + cleanedNumber);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

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
        syncFullHistory: false,
        markOnlineOnConnect: true
    });

    if (!activeSessions[cleanedNumber]) {
        activeSessions[cleanedNumber] = { sock, isConnected: false, pairingCode: null, sessionDir };
    } else {
        activeSessions[cleanedNumber].sock = sock;
    }

    const sessionData = activeSessions[cleanedNumber];

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanedNumber);
                const formattedCode = code ? code.match(/.{1,4}/g).join('-') : code;
                sessionData.pairingCode = formattedCode;
                if (reqResCallback) reqResCallback({ success: true, pairingCode: formattedCode });
            } catch (err) {
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
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => createBotSession(cleanedNumber), 3000);
            }
            sessionData.isConnected = false;
        } else if (connection === 'open') {
            sessionData.isConnected = true;
            sessionData.pairingCode = null;
            console.log('Bot Terhubung: ' + cleanedNumber);
        }
    });
}

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WA Bot HD & Smart Status Filter</title>
    <style>
        *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
        body{background:#0f172a;color:#f8fafc;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:14px}
        .card{background:#1e293b;width:100%;max-width:490px;padding:20px;border-radius:16px;border:1px solid #334155;box-shadow:0 10px 30px rgba(0,0,0,0.5)}
        h2{margin-top:0;font-size:20px;text-align:center;color:#38bdf8}
        .box{background:#0f172a;padding:14px;border-radius:12px;margin-bottom:14px;border:1px solid #334155;font-size:13px}
        .badge-on{color:#4ade80;font-weight:bold}
        .badge-off{color:#facc15;font-weight:bold}
        .pairing-code{font-size:22px;font-weight:800;letter-spacing:2px;color:#38bdf8;margin:8px 0;display:block;text-align:center}
        input[type="text"],input[type="search"]{width:100%;padding:11px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;margin-bottom:10px;font-size:14px}
        .upload-area{border:2px dashed #475569;border-radius:12px;padding:16px;text-align:center;margin-bottom:12px;cursor:pointer;display:block;background:#0b1120}
        .file-hidden{display:none}
        button{width:100%;padding:13px;background:#0284c7;color:white;border:none;border-radius:10px;font-size:15px;font-weight:bold;cursor:pointer;transition:0.2s}
        button:hover{background:#0369a1}
        button:disabled{background:#475569;cursor:not-allowed}
        .btn-sec{background:#334155;margin-bottom:8px;padding:10px;font-size:13px}
        .btn-sec:hover{background:#475569}
        .checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;cursor:pointer}
        #fileName,#contactFileName{margin-top:4px;font-size:12px;color:#94a3b8;word-break:break-all}
        #notif{margin-top:14px;text-align:center;font-size:13px;font-weight:500;white-space:pre-line;line-height:1.5}
        details.tutor-box{background:#0b1324;border:1px solid #0284c7;border-radius:10px;margin-bottom:16px;padding:10px 14px;font-size:13px}
        details.tutor-box summary{font-weight:bold;color:#38bdf8;cursor:pointer;outline:none;list-style:none;display:flex;justify-content:space-between;align-items:center}
        details.tutor-box summary::-webkit-details-marker{display:none}
        details.tutor-box summary::after{content:'➕';font-size:12px}
        details[open].tutor-box summary::after{content:'➖'}
        .tutor-content{margin-top:10px;line-height:1.5;color:#cbd5e1;border-top:1px solid #1e293b;padding-top:10px}
        .tutor-content ol{padding-left:18px;margin:6px 0}
        .contact-stats{display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;color:#cbd5e1}
        .contact-list{max-height:220px;overflow-y:auto;border:1px solid #334155;border-radius:8px;background:#090d16;padding:6px}
        .contact-item{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid #1e293b;font-size:12px}
        .contact-item:last-child{border-bottom:none}
        .contact-info{display:flex;flex-direction:column;overflow:hidden;max-width:75%}
        .contact-name{font-weight:bold;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .contact-num{color:#64748b;font-size:11px}
        .badge-excluded{color:#f87171;font-weight:bold;font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer}
    </style>
</head>
<body>
    <div class="card">
        <h2>🚀 Bot WA & Auto Status HD</h2>
        <details class="tutor-box">
            <summary>📖 Panduan Ekspor Kontak HP</summary>
            <div class="tutor-content">
                <b>Cara Ekspor File Kontak Langsung dari HP:</b>
                <ol>
                    <li>Buka aplikasi <b>Kontak</b> bawaan di HP Android.</li>
                    <li>Ketuk ikon <b>Setelan / Kelola Kontak</b> (ikon titik tiga/foto profil).</li>
                    <li>Pilih menu <b>Impor / Ekspor Kontak</b> ➔ pilih <b>Ekspor ke file (.vcf)</b>.</li>
                    <li>Simpan file di HP, lalu unggah pada kolom bagian 3 di bawah.</li>
                </ol>
            </div>
        </details>
        <div class="box">
            <label><b>1. Nomor Bot (Awali 62):</b></label>
            <input type="text" id="botNumberInput" placeholder="Contoh: 6285196971126" oninput="document.getElementById('targetNumber').value=this.value">
            <button type="button" class="btn-sec" onclick="connectBot()">🔗 Hubungkan / Cek Status</button>
            <div id="botStatusArea" style="text-align:center;font-size:12px;">Ketik nomor bot lalu klik Hubungkan.</div>
        </div>
        <form id="uploadForm">
            <div class="box">
                <label><b>2. Nomor Tujuan Chat (Kirim ke Chat Sendiri):</b></label>
                <input type="text" id="targetNumber" name="targetNumber" required>
            </div>
            <label class="upload-area" for="mediaInput">
                📁 <b>Pilih Foto / Video HD (Maks. 200MB)</b>
                <div id="fileName">Belum ada file dipilih</div>
                <input type="file" id="mediaInput" name="media" class="file-hidden" accept="image/*,video/*" required>
            </label>
            <input type="text" name="caption" placeholder="Tulis caption status (opsional)...">
            <label class="checkbox-row">
                <input type="checkbox" name="autoStatus" value="true" checked>
                <span>🔄 <b>Otomatis posting ke Status WhatsApp</b></span>
            </label>
            <div class="box">
                <label><b>3. Daftar Penonton Status (Upload File Kontak):</b></label>
                <label class="upload-area" for="contactFileInput" style="padding:10px;margin-top:6px;border-style:solid;background:#131d2e;">
                    📇 <b>Pilih File .VCF Kontak HP</b>
                    <div id="contactFileName">Belum ada file kontak dimasukkan</div>
                    <input type="file" id="contactFileInput" class="file-hidden" accept=".vcf,.csv">
                </label>
                <div id="filterControls" style="display:none;">
                    <div class="contact-stats">
                        <span>Total: <b id="statTotal">0</b></span>
                        <span style="color:#4ade80;">Penonton: <b id="statAudience">0</b></span>
                        <span style="color:#f87171;">Dikecualikan: <b id="statExcluded">0</b></span>
                    </div>
                    <input type="search" id="searchContact" placeholder="🔍 Cari nama kontak..." oninput="filterContacts()">
                    <div class="contact-list" id="contactListContainer"></div>
                </div>
            </div>
            <button type="submit" id="submitBtn">Kirim Media & Auto Status</button>
        </form>
        <div id="notif"></div>
    </div>
    <script>
        const mediaInput = document.getElementById('mediaInput');
        const fileName = document.getElementById('fileName');
        const contactFileInput = document.getElementById('contactFileInput');
        const contactFileName = document.getElementById('contactFileName');
        const notif = document.getElementById('notif');
        let parsedContacts = [], statusInterval;

        window.addEventListener('DOMContentLoaded', () => {
            const saved = localStorage.getItem('bot_cached_contacts');
            if (saved) {
                try {
                    parsedContacts = JSON.parse(saved);
                    if (parsedContacts.length > 0) {
                        contactFileName.innerText = '✅ Tersimpan ' + parsedContacts.length + ' kontak';
                        document.getElementById('filterControls').style.display = 'block';
                        updateStats();
                        renderList(parsedContacts);
                    }
                } catch(e) {}
            }
        });

        mediaInput.addEventListener('change', () => {
            if (mediaInput.files.length > 0) {
                fileName.innerText = mediaInput.files[0].name + ' (' + (mediaInput.files[0].size / (1024 * 1024)).toFixed(2) + ' MB)';
            }
        });

        contactFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            contactFileName.innerText = file.name;
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result || '';
                parsedContacts = parseVCF(content);
                if (parsedContacts.length > 0) {
                    localStorage.setItem('bot_cached_contacts', JSON.stringify(parsedContacts));
                    document.getElementById('filterControls').style.display = 'block';
                    updateStats();
                    renderList(parsedContacts);
                } else alert('Tidak ada nomor valid dari file ini.');
            };
            reader.readAsText(file);
        });

        function cleanPhone(raw) {
            let c = String(raw || '').replace(/[^0-9]/g, '');
            if (c.startsWith('62628')) c = c.slice(2);
            else if (c.startsWith('08')) c = '628' + c.slice(2);
            else if (c.startsWith('0')) c = '62' + c.slice(1);
            else if (c.startsWith('8')) c = '628' + c.slice(1);
            return (c.length < 10 || c.length > 15 || c === '1500445' || c === '628564') ? '' : c;
        }

        function parseVCF(vcfText) {
            const cards = vcfText.split('BEGIN:VCARD');
            const list = [], seen = new Set();
            for (let i = 0; i < cards.length; i++) {
                const lines = cards[i].split('\\n');
                let name = '';
                const nums = [];
                for (let j = 0; j < lines.length; j++) {
                    const line = lines[j].trim();
                    if (line.toUpperCase().startsWith('FN')) {
                        const parts = line.split(':');
                        if (parts.length > 1) name = parts.slice(1).join(':').trim();
                    } else if (line.toUpperCase().startsWith('TEL')) {
                        const parts = line.split(':');
                        if (parts.length > 1) {
                            const cleaned = cleanPhone(parts[parts.length - 1]);
                            if (cleaned) nums.push(cleaned);
                        }
                    }
                }
                for (let k = 0; k < nums.length; k++) {
                    const num = nums[k];
                    if (!seen.has(num)) {
                        seen.add(num);
                        list.push({ name: name || num, number: num, excluded: false });
                    }
                }
            }
            return list;
        }

        function renderList(items) {
            const container = document.getElementById('contactListContainer');
            container.innerHTML = '';
            if (items.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:12px;color:#64748b;">Kontak tidak ditemukan.</div>';
                return;
            }
            items.forEach((c) => {
                const row = document.createElement('div');
                row.className = 'contact-item';
                
                const info = document.createElement('div');
                info.className = 'contact-info';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'contact-name';
                nameSpan.textContent = c.name;
                
                const numSpan = document.createElement('span');
                numSpan.className = 'contact-num';
                numSpan.textContent = c.number;
                
                info.appendChild(nameSpan);
                info.appendChild(numSpan);
                
                const label = document.createElement('label');
                label.className = 'badge-excluded';
                
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = c.excluded;
                cb.onchange = function() {
                    c.excluded = cb.checked;
                    localStorage.setItem('bot_cached_contacts', JSON.stringify(parsedContacts));
                    updateStats();
                };
                
                const txt = document.createElement('span');
                txt.textContent = 'Kecualikan';
                
                label.appendChild(cb);
                label.appendChild(txt);
                
                row.appendChild(info);
                row.appendChild(label);
                container.appendChild(row);
            });
        }

        function filterContacts() {
            const kw = document.getElementById('searchContact').value.toLowerCase().trim();
            renderList(parsedContacts.filter(c => c.name.toLowerCase().includes(kw) || c.number.includes(kw)));
        }

        function updateStats() {
            const exc = parsedContacts.filter(c => c.excluded).length;
            document.getElementById('statTotal').innerText = parsedContacts.length;
            document.getElementById('statAudience').innerText = parsedContacts.length - exc;
            document.getElementById('statExcluded').innerText = exc;
        }

        async function connectBot() {
            const num = document.getElementById('botNumberInput').value.trim();
            if (!num) { alert('Masukkan nomor bot!'); return; }
            document.getElementById('botStatusArea').innerHTML = '⏳ Memeriksa sesi...';
            const res = await fetch('/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botNumber: num }) });
            const data = await res.json();
            if (data.success) pollStatus(num);
            else alert('Gagal: ' + data.message);
        }

        async function pollStatus(num) {
            if (statusInterval) clearInterval(statusInterval);
            statusInterval = setInterval(async () => {
                const res = await fetch('/status?botNumber=' + num);
                const data = await res.json();
                const area = document.getElementById('botStatusArea');
                if (data.connected) {
                    area.innerHTML = 'Status Bot (' + num + '): <span class="badge-on">● Terhubung</span>';
                    clearInterval(statusInterval);
                } else {
                    area.innerHTML = 'Status Bot: <span class="badge-off">● Belum Tertaut</span>' + (data.pairingCode ? '<span class="pairing-code">' + data.pairingCode + '</span><small>Masukkan kode di Perangkat Tertaut WA</small>' : '<br><small>Menyiapkan koneksi...</small>');
                }
            }, 2500);
        }

        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const botNum = document.getElementById('botNumberInput').value.trim();
            if (!botNum) { alert('Masukkan nomor bot!'); return; }
            if (!mediaInput.files.length) return;

            const audienceNumbers = parsedContacts.filter(c => !c.excluded).map(c => c.number);
            const formData = new FormData(e.target);
            formData.append('botNumber', botNum);
            formData.append('audienceList', JSON.stringify(audienceNumbers));

            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.innerText = '⏳ Mengunggah media & broadcast status...';
            notif.innerText = '';

            try {
                const res = await fetch('/send', { method: 'POST', body: formData });
                const result = await res.json();
                if (result.success) {
                    notif.style.color = '#4ade80';
                    notif.innerText = result.message;
                    mediaInput.value = '';
                    fileName.innerText = 'Belum ada file dipilih';
                } else {
                    notif.style.color = '#f87171';
                    notif.innerText = '❌ Gagal: ' + result.message;
                }
            } catch (err) {
                notif.style.color = '#f87171';
                notif.innerText = '❌ Kesalahan jaringan.';
            } finally {
                btn.disabled = false;
                btn.innerText = 'Kirim Media & Auto Status';
            }
        });
    </script>
</body>
</html>`);
});

app.post('/connect', (req, res) => {
    const { botNumber } = req.body;
    if (!botNumber) return res.status(400).json({ success: false, message: 'Nomor bot wajib diisi.' });
    createBotSession(botNumber, (result) => res.json(result));
});

app.get('/status', (req, res) => {
    const cleaned = (req.query.botNumber || '').replace(/[^0-9]/g, '');
    if (!cleaned || !activeSessions[cleaned]) {
        return res.json({ connected: false, pairingCode: null });
    }
    res.json({
        connected: activeSessions[cleaned].isConnected,
        pairingCode: activeSessions[cleaned].pairingCode
    });
});

app.post('/send', upload.single('media'), async (req, res) => {
    const { botNumber, targetNumber, caption, autoStatus, audienceList } = req.body;
    const cleanedBot = (botNumber || '').replace(/[^0-9]/g, '');

    if (!cleanedBot || !activeSessions[cleanedBot] || !activeSessions[cleanedBot].isConnected) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'Bot belum terhubung!' });
    }

    if (!req.file || !targetNumber) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'File/nomor belum lengkap.' });
    }

    const session = activeSessions[cleanedBot];
    const sock = session.sock;
    const filePath = req.file.path;
    const mime = req.file.mimetype || '';
    const ext = path.extname(req.file.originalname).toLowerCase();
    const cleanTarget = targetNumber.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

    try {
        const isVideo = mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm'].includes(ext);
        const isImage = mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

        if (!isVideo && !isImage) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'Harus Foto / Video!' });
        }

        const mediaBuffer = fs.readFileSync(filePath);

        // 1. Kirim ke Chat Pribadi (Hanya sebagai riwayat file HD)
        if (isVideo) {
            await sock.sendMessage(cleanTarget, { video: mediaBuffer, mimetype: 'video/mp4', caption: caption || '', gifPlayback: false });
        } else {
            await sock.sendMessage(cleanTarget, { image: mediaBuffer, caption: caption || '' });
        }

        let statusSuccess = false;
        let recipientCount = 0;

        // 2. Broadcast Status dengan Upload Baru (Kunci Sukses Muncul di "Status Saya")
        if (autoStatus === 'true') {
            try {
                const jidSet = new Set();
                const botOwnJid = sock.user && sock.user.id ? jidNormalizedUser(sock.user.id) : (cleanedBot + '@s.whatsapp.net');

                // MUTLAK: Tambahkan nomormu sendiri (Primary & Device) ke daftar supaya muncul di "Status Saya"
                jidSet.add(botOwnJid);
                if (sock.user && sock.user.id) jidSet.add(sock.user.id);
                jidSet.add(cleanTarget);

                // Tambahkan penonton dari file VCF yang difilter
                if (audienceList) {
                    const parsedAudience = JSON.parse(audienceList);
                    if (Array.isArray(parsedAudience)) {
                        for (let i = 0; i < parsedAudience.length; i++) {
                            const cleanNum = String(parsedAudience[i]).replace(/[^0-9]/g, '');
                            // Keamanan filter kontak: wajib nomor valid > 9 digit
                            if (cleanNum.length >= 10 && cleanNum.length <= 15) {
                                jidSet.add(cleanNum + '@s.whatsapp.net');
                            }
                        }
                    }
                }

                // Ubah Set ke Array yang aman dari undefined
                const finalJidArray = Array.from(jidSet).filter(jid => jid && jid.endsWith('@s.whatsapp.net') && jid.length > 20);
                recipientCount = finalJidArray.length;

                if (recipientCount > 0) {
                    // Gunakan sendMessage khusus status (WhatsApp butuh upload ulang khusus Status agar Media Key valid untuk semua kontak)
                    if (isVideo) {
                        await sock.sendMessage('status@broadcast', { video: mediaBuffer, caption: caption || '', mimetype: 'video/mp4' }, { statusJidList: finalJidArray });
                    } else {
                        await sock.sendMessage('status@broadcast', { image: mediaBuffer, caption: caption || '' }, { statusJidList: finalJidArray });
                    }
                    statusSuccess = true;
                }
            } catch (err) {
                console.error('Error saat upload status:', err);
            }
        }

        // Hapus file dari memori server untuk menghemat ruang
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        if (statusSuccess) {
            return res.json({ success: true, message: '✅ Media terkirim ke Chat!\n✅ Status WA BERHASIL masuk ke Status Saya & disiarkan ke ' + recipientCount + ' kontak!' });
        } else {
            return res.json({ success: true, message: '✅ Media masuk ke Chat pribadi (Gagal upload status).' });
        }
    } catch (error) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ success: false, message: error.message || 'Gagal mengirim media.' });
    }
});

app.listen(PORT, () => {
    console.log('Server berjalan di port ' + PORT);
});
// === AKHIR KODE ===
