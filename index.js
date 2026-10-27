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

function toUserJid(numOrJid) {
    if (!numOrJid) return null;
    let s = String(numOrJid).trim();
    if (s.includes('@')) {
        s = jidNormalizedUser(s);
        if (s.endsWith('@s.whatsapp.net')) return s;
        return null;
    }
    const digits = s.replace(/[^0-9]/g, '');
    if (digits.length < 10) return null;
    return digits + '@s.whatsapp.net';
}

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
    sessionData.contacts.add(cleanedNumber + '@s.whatsapp.net');

    sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
        if (contacts) {
            for (const c of contacts) {
                const j = toUserJid(c.id);
                if (j) sessionData.contacts.add(j);
            }
        }
        if (chats) {
            for (const ch of chats) {
                const j = toUserJid(ch.id);
                if (j) sessionData.contacts.add(j);
            }
        }
        console.log(`[${cleanedNumber}] Kontak status: ${sessionData.contacts.size}`);
    });

    sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
            const j = toUserJid(c.id);
            if (j) sessionData.contacts.add(j);
        }
    });

    sock.ev.on('contacts.update', (updates) => {
        for (const c of updates) {
            const j = toUserJid(c.id);
            if (j) sessionData.contacts.add(j);
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
                const me = toUserJid(sock.user.id);
                if (me) sessionData.contacts.add(me);
            }
            console.log(`✅ Bot ${cleanedNumber} Terhubung! Kontak: ${sessionData.contacts.size}`);
        }
    });
}

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WA Auto-Forward Status HD</title>
<style>
*{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
body{background:#0f172a;color:#f8fafc;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#1e293b;width:100%;max-width:440px;padding:24px;border-radius:16px;border:1px solid #334155}
h2{margin-top:0;font-size:20px;text-align:center;color:#38bdf8}
.box{background:#0f172a;padding:14px;border-radius:10px;margin-bottom:16px;border:1px solid #334155;font-size:13px}
.badge-on{color:#4ade80;font-weight:bold}
.badge-off{color:#facc15;font-weight:bold}
.pairing-code{font-size:22px;font-weight:800;letter-spacing:2px;color:#38bdf8;margin:8px 0;display:block;text-align:center}
input[type=text]{width:100%;padding:12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;margin-bottom:10px;font-size:14px}
.upload-area{border:2px dashed #475569;border-radius:12px;padding:20px;text-align:center;margin-bottom:12px;cursor:pointer;display:block}
input[type=file]{display:none}
button{width:100%;padding:13px;background:#0284c7;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:bold;cursor:pointer}
button:disabled{background:#475569}
.btn-sec{background:#334155;margin-bottom:10px}
.checkbox-container{display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:14px}
#fileName{margin-top:6px;font-size:12px;color:#94a3b8;word-break:break-all}
#notif{margin-top:14px;text-align:center;font-size:13px;font-weight:500;line-height:1.5;white-space:pre-line}
small.hint{color:#94a3b8;display:block;margin-top:-6px;margin-bottom:10px;font-size:11px}
</style>
</head>
<body>
<div class="card">
<h2>🚀 Bot WA & Auto-Forward Status</h2>
<div class="box">
<label><b>1. Nomor Bot (Awali 62):</b></label>
<input type="text" id="botNumberInput" placeholder="628xxxxxxxxxx" oninput="syncNumber(this.value)">
<button type="button" class="btn-sec" onclick="connectBot()">🔗 Hubungkan / Cek Status</button>
<div id="botStatusArea" style="margin-top:8px;text-align:center">Masukkan nomor di atas.</div>
</div>
<form id="uploadForm">
<div class="box">
<label><b>2. Nomor Tujuan Chat (otomatis nomor sendiri):</b></label>
<input type="text" id="targetNumber" name="targetNumber" placeholder="628xxxxxxxxxx" required>
<small class="hint">*Kirim ke chat dulu (HD), lalu upload ke Status.</small>
</div>
<label class="upload-area" for="mediaInput">
📁 <b>Pilih Foto / Video (max 200MB, video status ideal &lt; 60 detik)</b>
<div id="fileName">Belum ada file</div>
<input type="file" id="mediaInput" name="media" accept="image/*,video/*" required>
</label>
<input type="text" name="caption" placeholder="Caption status (opsional)">
<label class="checkbox-container">
<input type="checkbox" name="autoStatus" value="true" checked>
<span>🔄 Upload ke Status WhatsApp</span>
</label>
<div class="box">
<label><b>Nomor penonton status (WAJIB isi minimal 1–2 teman):</b></label>
<input type="text" name="extraContacts" placeholder="62812xxx, 62857xxx">
<small class="hint">*Tanpa daftar penonton, status sering tidak muncul. Isi nomor kontak yang ada di HP kamu.</small>
</div>
<button type="submit" id="submitBtn">Kirim ke Chat ➔ Status</button>
</form>
<div id="notif"></div>
</div>
<script>
const mediaInput=document.getElementById('mediaInput');
const fileName=document.getElementById('fileName');
const notif=document.getElementById('notif');
let statusInterval;
function syncNumber(v){document.getElementById('targetNumber').value=v}
mediaInput.addEventListener('change',()=>{
if(mediaInput.files.length){const f=mediaInput.files[0];fileName.innerText=f.name+' ('+(f.size/1048576).toFixed(2)+' MB)'}
});
async function connectBot(){
const num=document.getElementById('botNumberInput').value.trim();
if(!num){alert('Isi nomor!');return}
document.getElementById('botStatusArea').innerHTML='⏳ Meminta kode...';
const res=await fetch('/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({botNumber:num})});
const data=await res.json();
if(data.success)pollStatus(num);else alert('Gagal: '+data.message);
}
async function pollStatus(num){
if(statusInterval)clearInterval(statusInterval);
statusInterval=setInterval(async()=>{
const res=await fetch('/status?botNumber='+encodeURIComponent(num));
const data=await res.json();
const area=document.getElementById('botStatusArea');
if(data.connected){
area.innerHTML='Status: <span class="badge-on">● Terhubung</span><br><small>Kontak: '+data.contactCount+'</small>';
clearInterval(statusInterval);
}else{
area.innerHTML='Status: <span class="badge-off">● Belum Tertaut</span>'+(data.pairingCode?'<span class="pairing-code">'+data.pairingCode+'</span><small>Masukkan di Linked Devices</small>':'<br><small>Menyiapkan...</small>');
}
},2500);
}
document.getElementById('uploadForm').addEventListener('submit',async(e)=>{
e.preventDefault();
const botNum=document.getElementById('botNumberInput').value.trim();
if(!botNum){alert('Isi nomor bot!');return}
if(!mediaInput.files.length)return;
const fd=new FormData(e.target);
fd.append('botNumber',botNum);
const btn=document.getElementById('submitBtn');
btn.disabled=true;btn.innerText='⏳ Mengirim...';notif.innerText='';
try{
const res=await fetch('/send',{method:'POST',body:fd});
const result=await res.json();
notif.style.color=result.success?'#4ade80':'#f87171';
notif.innerText=result.message||JSON.stringify(result);
if(result.success){e.target.reset();syncNumber(botNum);fileName.innerText='Belum ada file'}
}catch(err){notif.style.color='#f87171';notif.innerText='Error jaringan'}
finally{btn.disabled=false;btn.innerText='Kirim ke Chat ➔ Status'}
});
</script>
</body>
</html>`);
});

app.post('/connect', (req, res) => {
    const { botNumber } = req.body;
    if (!botNumber) return res.status(400).json({ success: false, message: 'Nomor bot wajib.' });
    let responded = false;
    const reply = (p) => { if (responded) return; responded = true; res.json(p); };
    setTimeout(() => { if (!responded) reply({ success: true, message: 'Sesi dibuat, cek status.' }); }, 20000);
    createBotSession(botNumber, reply).catch(err => reply({ success: false, message: err.message }));
});

app.get('/status', (req, res) => {
    const cleaned = (req.query.botNumber || '').replace(/[^0-9]/g, '');
    if (!cleaned || !activeSessions[cleaned]) {
        return res.json({ connected: false, pairingCode: null, contactCount: 0 });
    }
    const s = activeSessions[cleaned];
    res.json({
        connected: s.isConnected,
        pairingCode: s.pairingCode,
        contactCount: s.contacts ? s.contacts.size : 0
    });
});

app.post('/send', upload.single('media'), async (req, res) => {
    const { botNumber, targetNumber, caption, autoStatus, extraContacts } = req.body;
    const cleanedBot = (botNumber || '').replace(/[^0-9]/g, '');

    if (!cleanedBot || !activeSessions[cleanedBot] || !activeSessions[cleanedBot].isConnected) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ success: false, message: 'Bot belum terhubung.' });
    }
    if (!req.file || !targetNumber) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ success: false, message: 'File / nomor tujuan kurang.' });
    }

    const session = activeSessions[cleanedBot];
    const sock = session.sock;
    const filePath = req.file.path;
    const mime = req.file.mimetype || '';
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const cleanTarget = toUserJid(targetNumber);

    if (!cleanTarget) {
        try { fs.unlinkSync(filePath); } catch {}
        return res.status(400).json({ success: false, message: 'Nomor tujuan tidak valid.' });
    }

    try {
        const isVideo = mime.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm'].includes(ext);
        const isImage = mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
        if (!isVideo && !isImage) {
            fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'Harus foto atau video.' });
        }

        const mediaBuffer = fs.readFileSync(filePath);

        // 1) Chat ke nomor sendiri
        if (isVideo) {
            await sock.sendMessage(cleanTarget, {
                video: mediaBuffer,
                mimetype: 'video/mp4',
                caption: caption || '',
                gifPlayback: false
            });
        } else {
            await sock.sendMessage(cleanTarget, {
                image: mediaBuffer,
                caption: caption || ''
            });
        }
        console.log(`[${cleanedBot}] Chat OK → ${cleanTarget}`);

        if (autoStatus !== 'true') {
            try { fs.unlinkSync(filePath); } catch {}
            return res.json({ success: true, message: '✅ Terkirim ke chat saja (auto status off).' });
        }

        // 2) Susun statusJidList (WAJIB ada isi)
        const jidSet = new Set();
        if (session.contacts) {
            for (const j of session.contacts) {
                const n = toUserJid(j);
                if (n) jidSet.add(n);
            }
        }
        jidSet.add(cleanTarget);
        const me = toUserJid(sock.user?.id);
        if (me) jidSet.add(me);

        if (extraContacts) {
            for (const part of String(extraContacts).split(/[,;\s]+/)) {
                const n = toUserJid(part);
                if (n) jidSet.add(n);
            }
        }

        let statusJidList = Array.from(jidSet);
        if (statusJidList.length < 2 && me) {
            // minimal me + target
            statusJidList = Array.from(new Set([me, cleanTarget].filter(Boolean)));
        }

        if (!statusJidList.length) {
            try { fs.unlinkSync(filePath); } catch {}
            return res.json({
                success: true,
                message: '✅ Chat berhasil.\n⚠️ Status dilewati: statusJidList kosong. Isi “Nomor penonton status” dengan 1–2 nomor teman.'
            });
        }

        console.log(`[\( {cleanedBot}] statusJidList ( \){statusJidList.length}):`, statusJidList.slice(0, 5));

        // 3) Upload status — opsi HARUS di argumen ke-3
        let statusMsg;
        if (isVideo) {
            statusMsg = await sock.sendMessage(
                'status@broadcast',
                {
                    video: mediaBuffer,
                    mimetype: 'video/mp4',
                    caption: caption || ''
                },
                {
                    statusJidList,
                    broadcast: true
                }
            );
        } else {
            statusMsg = await sock.sendMessage(
                'status@broadcast',
                {
                    image: mediaBuffer,
                    caption: caption || ''
                },
                {
                    statusJidList,
                    broadcast: true
                }
            );
        }

        console.log(`[${cleanedBot}] Status OK id=`, statusMsg?.key?.id);

        try { fs.unlinkSync(filePath); } catch {}

        return res.json({
            success: true,
            message:
                '✅ Chat terkirim.\n✅ Status terkirim ke WhatsApp.\n' +
                'Penonton: ' + statusJidList.length + ' nomor.\n' +
                'Cek di HP: Status → My status (bukan hanya chat).\n' +
                'Video status ideal di bawah ±60 detik.'
        });
    } catch (error) {
        if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch {}
        console.error(`[${cleanedBot}] Error:`, error);
        res.status(500).json({
            success: false,
            message: 'Gagal: ' + (error.message || String(error))
        });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Server jalan di port ${PORT}`);
});
