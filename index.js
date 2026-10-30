const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const express = require('express');
const multer = require('multer');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const app = express();
const logger = pino({ level: 'silent' });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 200 * 1024 * 1024 } // Batas upload 200 MB
});

let activeSessions = {};

async function createBotSession(botNumber, reqResCallback) {
    const cleanedNumber = botNumber.replace(/[^0-9]/g, '');
    const sessionDir = path.join(__dirname, 'sessions', `session_${cleanedNumber}`);

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
            sessionDir
        };
    } else {
        activeSessions[cleanedNumber].sock = sock;
    }

    const sessionData = activeSessions[cleanedNumber];

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanedNumber);
                const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
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
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            sessionData.isConnected = false;
            if (shouldReconnect) {
                setTimeout(() => createBotSession(cleanedNumber), 3000);
            }
        } else if (connection === 'open') {
            sessionData.isConnected = true;
            sessionData.pairingCode = null;
            console.log(`✅ Bot ${cleanedNumber} Terhubung!`);
        }
    });
}

// ================= TAMPILAN WEB (HTML/CSS/JS) =================
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WA Bot HD & Smart Status Filter</title>
    <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 14px; }
        .card { background: #1e293b; width: 100%; max-width: 480px; padding: 22px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.45); border: 1px solid #334155; }
        h2 { margin-top: 0; font-size: 20px; text-align: center; color: #38bdf8; }
        .box { background: #0f172a; padding: 14px; border-radius: 12px; margin-bottom: 14px; border: 1px solid #334155; font-size: 13px; }
        .badge-on { color: #4ade80; font-weight: bold; }
        .badge-off { color: #facc15; font-weight: bold; }
        .pairing-code { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #38bdf8; margin: 8px 0; display: block; text-align: center; }
        input[type="text"], input[type="search"] { width: 100%; padding: 11px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; margin-bottom: 10px; font-size: 14px; }
        .upload-area { border: 2px dashed #475569; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 12px; cursor: pointer; display: block; background: #0b1120; }
        .file-hidden { display: none; }
        button { width: 100%; padding: 13px; background: #0284c7; color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        button:hover { background: #0369a1; }
        button:disabled { background: #475569; cursor: not-allowed; }
        .btn-sec { background: #334155; margin-bottom: 8px; padding: 10px; font-size: 13px; }
        .btn-sec:hover { background: #475569; }
        .checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; cursor: pointer; }
        #fileName, #contactFileName { margin-top: 4px; font-size: 12px; color: #94a3b8; word-break: break-all; }
        #notif { margin-top: 14px; text-align: center; font-size: 13px; font-weight: 500; line-height: 1.5; white-space: pre-line; }
        
        /* Contact Filter UI */
        .contact-stats { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px; color: #cbd5e1; }
        .contact-list { max-height: 230px; overflow-y: auto; border: 1px solid #334155; border-radius: 8px; background: #090d16; padding: 6px; }
        .contact-item { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-bottom: 1px solid #1e293b; font-size: 12px; }
        .contact-item:last-child { border-bottom: none; }
        .contact-info { display: flex; flex-direction: column; overflow: hidden; max-width: 78%; }
        .contact-name { font-weight: bold; color: #f1f5f9; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
        .contact-num { color: #64748b; font-size: 11px; }
        .badge-excluded { color: #f87171; font-weight: bold; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
    </style>
</head>
<body>
    <div class="card">
        <h2>🚀 Bot WA & Smart Status HD</h2>
        
        <!-- Sesi Bot -->
        <div class="box">
            <label><b>1. Nomor Bot (Awali 62):</b></label>
            <input type="text" id="botNumberInput" placeholder="Contoh: 6285196971126" oninput="syncTarget(this.value)">
            <button type="button" class="btn-sec" onclick="connectBot()">🔗 Hubungkan / Cek Status</button>
            <div id="botStatusArea" style="text-align: center; font-size: 12px;">Ketik nomor bot di atas lalu klik Hubungkan.</div>
        </div>

        <form id="uploadForm">
            <div class="box">
                <label><b>2. Nomor Tujuan Chat (Otomatis Nomor Sendiri):</b></label>
                <input type="text" id="targetNumber" name="targetNumber" placeholder="Contoh: 6285196971126" required>
            </div>

            <!-- Upload Media -->
            <label class="upload-area" for="mediaInput">
                📁 <b>Pilih Foto / Video HD (Maks. 200MB)</b>
                <div id="fileName">Belum ada file dipilih</div>
                <input type="file" id="mediaInput" name="media" class="file-hidden" accept="image/*,video/*" required>
            </label>

            <input type="text" name="caption" placeholder="Tulis caption status (opsional)...">

            <label class="checkbox-row">
                <input type="checkbox" id="autoStatusCheck" name="autoStatus" value="true" checked>
                <span>🔄 <b>Otomatis teruskan ke Status WhatsApp</b></span>
            </label>

            <!-- Fitur Baru: Unggah & Filter Kontak -->
            <div class="box" id="contactSection">
                <label><b>3. Daftar Penonton Status (Upload File Kontak):</b></label>
                
                <label class="upload-area" for="contactFileInput" style="padding: 10px; margin-top: 6px; border-style: solid; background: #131d2e;">
                    📇 <b>Pilih File .VCF atau .CSV Kontak</b>
                    <div id="contactFileName">Belum ada file kontak dimasukkan</div>
                    <input type="file" id="contactFileInput" class="file-hidden" accept=".vcf,.csv">
                </label>

                <div id="filterControls" style="display: none;">
                    <div class="contact-stats">
                        <span>Total: <b id="statTotal">0</b></span>
                        <span style="color: #4ade80;">Penonton: <b id="statAudience">0</b></span>
                        <span style="color: #f87171;">Dikecualikan: <b id="statExcluded">0</b></span>
                    </div>

                    <input type="search" id="searchContact" placeholder="🔍 Cari nama kontak (cth: Mamah, Guru)..." oninput="filterContacts()">

                    <div class="contact-list" id="contactListContainer">
                        <!-- List kontak dirender otomatis lewat JS -->
                    </div>
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

        let parsedContacts = []; // Array of { name, number, excluded }
        let statusInterval;

        function syncTarget(val) {
            document.getElementById('targetNumber').value = val;
        }

        mediaInput.addEventListener('change', () => {
            if (mediaInput.files.length > 0) {
                const f = mediaInput.files[0];
                fileName.innerText = f.name + ' (' + (f.size / (1024 * 1024)).toFixed(2) + ' MB)';
            }
        });

        // 1. Parsing File Kontak (.VCF & .CSV)
        contactFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            contactFileName.innerText = file.name;
            const reader = new FileReader();

            reader.onload = (event) => {
                const content = event.target.result;
                if (file.name.toLowerCase().endsWith('.vcf')) {
                    parsedContacts = parseVCF(content);
                } else {
                    parsedContacts = parseCSV(content);
                }

                if (parsedContacts.length > 0) {
                    document.getElementById('filterControls').style.display = 'block';
                    updateStats();
                    renderList(parsedContacts);
                } else {
                    alert('Tidak ada nomor yang berhasil dibaca dari file ini.');
                }
            };

            reader.readAsText(file);
        });

        function cleanPhone(raw) {
            let c = (raw || '').replace(/[^0-9]/g, '');
            if (c.startsWith('62628')) c = c.slice(2);
            else if (c.startsWith('08')) c = '628' + c.slice(2);
            else if (c.startsWith('0')) c = '62' + c.slice(1);
            else if (c.startsWith('8')) c = '628' + c.slice(1);
            return c;
        }

        function parseVCF(vcfText) {
            const cards = vcfText.split(/BEGIN:VCARD/i);
            const list = [];
            const seen = new Set();

            for (const block of cards) {
                if (!block.trim()) continue;
                let nameMatch = block.match(/FN(?:;[^:]*)?:(.*)/i);
                let name = nameMatch ? nameMatch[1].trim() : '';

                // Handle UTF-8 Quoted Printable pada VCF
                if (name.includes('=')) {
                    try {
                        name = decodeURIComponent(name.replace(/=([0-9A-F]{2})/g, '%$1'));
                    } catch(err) {}
                }

                const telMatches = block.matchAll(/TEL(?:;[^:]*)?:(.*)/gi);
                for (const tm of telMatches) {
                    const num = cleanPhone(tm[1]);
                    if (num.length >= 9 && num !== '1500445' && !seen.has(num)) {
                        seen.add(num);
                        list.push({
                            name: name || num,
                            number: num,
                            excluded: false
                        });
                    }
                }
            }
            return list;
        }

        function parseCSV(csvText) {
            const lines = csvText.split(/\\r?\\n/);
            if (lines.length < 2) return [];
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
            
            const nameIdx = headers.findIndex(h => h === 'first name' || h === 'name' || h.includes('nama'));
            const phoneIdx = headers.findIndex(h => h.includes('phone 1 - value') || h.includes('telepon') || h.includes('phone') || h.includes('mobile'));

            const list = [];
            const seen = new Set();

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                if (phoneIdx !== -1 && cols.length > phoneIdx) {
                    const rawNum = cols[phoneIdx].replace(/^"|"$/g, '').trim();
                    const num = cleanPhone(rawNum);
                    let name = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx].replace(/^"|"$/g, '').trim() : num;

                    if (num.length >= 9 && num !== '1500445' && !seen.has(num)) {
                        seen.add(num);
                        list.push({
                            name: name || num,
                            number: num,
                            excluded: false
                        });
                    }
                }
            }
            return list;
        }

        // 2. Render Daftar Kontak & Fitur Pencarian
        function renderList(contactsToRender) {
            const container = document.getElementById('contactListContainer');
            container.innerHTML = '';

            if (contactsToRender.length === 0) {
                container.innerHTML = '<div style="text-align: center; padding: 12px; color: #64748b;">Kontak tidak ditemukan.</div>';
                return;
            }

            contactsToRender.forEach((c) => {
                const item = document.createElement('div');
                item.className = 'contact-item';

                item.innerHTML = \`
                    <div class="contact-info">
                        <span class="contact-name">\${escapeHtml(c.name)}</span>
                        <span class="contact-num">\${c.number}</span>
                    </div>
                    <label class="badge-excluded">
                        <input type="checkbox" onchange="toggleExclude('\${c.number}', this.checked)" \${c.excluded ? 'checked' : ''}>
                        <span>Kecualikan</span>
                    </label>
                \`;
                container.appendChild(item);
            });
        }

        function escapeHtml(text) {
            return text.replace(/[&<>"']/g, function(m) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
            });
        }

        function filterContacts() {
            const keyword = document.getElementById('searchContact').value.toLowerCase().trim();
            const filtered = parsedContacts.filter(c => 
                c.name.toLowerCase().includes(keyword) || c.number.includes(keyword)
            );
            renderList(filtered);
        }

        function toggleExclude(number, isChecked) {
            const found = parsedContacts.find(c => c.number === number);
            if (found) {
                found.excluded = isChecked;
                updateStats();
            }
        }

        function updateStats() {
            const total = parsedContacts.length;
            const excluded = parsedContacts.filter(c => c.excluded).length;
            const audience = total - excluded;

            document.getElementById('statTotal').innerText = total;
            document.getElementById('statAudience').innerText = audience;
            document.getElementById('statExcluded').innerText = excluded;
        }

        // 3. Manajemen Koneksi Bot
        async function connectBot() {
            const num = document.getElementById('botNumberInput').value.trim();
            if (!num) { alert('Masukkan nomor bot terlebih dahulu!'); return; }
            
            document.getElementById('botStatusArea').innerHTML = '⏳ Memeriksa sesi...';
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
                    area.innerHTML = 'Status Bot (' + num + '): <span class="badge-on">● Terhubung</span>';
                    clearInterval(statusInterval);
                } else {
                    area.innerHTML = 'Status Bot: <span class="badge-off">● Belum Tertaut</span>' +
                        (data.pairingCode ? '<span class="pairing-code">' + data.pairingCode + '</span><small>Masukkan kode di Perangkat Tertaut WA</small>' : '<br><small>Menyiapkan koneksi...</small>');
                }
            }, 2500);
        }

        // 4. Submit Pengiriman Media & Auto-Status dengan Filter
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const botNum = document.getElementById('botNumberInput').value.trim();
            if (!botNum) { alert('Masukkan nomor bot di bagian atas!'); return; }
            if (!mediaInput.files.length) return;

            // Kumpulkan hanya nomor yang TIDAK dikecualikan
            const audienceNumbers = parsedContacts
                .filter(c => !c.excluded)
                .map(c => c.number);

            const formData = new FormData(e.target);
            formData.append('botNumber', botNum);
            formData.append('audienceList', JSON.stringify(audienceNumbers));

            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.innerText = '⏳ Sedang mengirim & m
