const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios'); // ইএসপি৩২ থেকে সরাসরি ডাটা পাইপলাইন করার জন্য
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('esp32_cloud_secret_cookie_key'));

// গ্লোবাল মেমোরি ক্যাশ
let cloudStorage = {
    connected: false,
    esp32Ip: "", // ইএসপি৩২ এর লোকাল আইপি ট্র্যাক রাখার জন্য
    totalSpace: "0.00",
    freeSpace: "0.00",
    usedPercentage: 0,
    fileTree: {},
    lastUpdated: "Never"
};

let adminCredentials = { username: "admin", password: "" };

const requireAuth = (req, res, next) => {
    if (req.signedCookies.isLoggedIn === 'true') next();
    else res.redirect('/login');
};

// ফ্ল্যাট পাথ থেকে ফোল্ডার ট্রি তৈরি (যেমন: "/Folder1/Sub/video.mp4")
function buildFileTree(files) {
    const tree = { _files: [] };
    files.forEach(file => {
        const parts = file.split('/').filter(p => p);
        let current = tree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                current._files.push({ name: part, fullPath: file });
            } else {
                if (!current[part]) current[part] = { _files: [] };
                current = current[part];
            }
        }
    });
    return tree;
}

// --- ১. ESP32 ডাটা ও আইপি সিঙ্ক এপিআই ---
app.post('/api/ping', (req, res) => {
    const { total, free, files, admin_u, admin_p, local_ip } = req.body;
    
    cloudStorage.connected = true;
    cloudStorage.esp32Ip = local_ip; // ইএসপি৩২ এর রিয়েল আইপি সেভ হচ্ছে
    cloudStorage.totalSpace = total || "0.00";
    cloudStorage.freeSpace = free || "0.00";
    cloudStorage.fileTree = files ? buildFileTree(files) : { _files: [] };

    let totalNum = parseFloat(total);
    let freeNum = parseFloat(free);
    if (totalNum > 0) {
        cloudStorage.usedPercentage = Math.round(((totalNum - freeNum) / totalNum) * 100);
    }
    
    if (admin_u && admin_p) {
        adminCredentials.username = admin_u;
        adminCredentials.password = admin_p;
    }
    
    cloudStorage.lastUpdated = new Date().toLocaleTimeString();
    res.status(200).send("OK");
});

// --- ২. রিয়েল মিডিয়া স্ট্রিমিং পাইপলাইন রাউট (🔥 মূল ফিক্স) ---
// এই রাউটটি ব্রাউজার এবং ESP32 এর মধ্যে একটি লাইভ টানেল তৈরি করে
app.get('/stream-media', requireAuth, async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send("File path missing");
    if (!cloudStorage.connected || !cloudStorage.esp32Ip) return res.status(503).send("ESP32 Hardware Offline");

    // এক্সটেনশন অনুযায়ী সঠিক MIME Type সেট করা যাতে ব্রাউজার প্লেয়ার একটিভ হয়
    const ext = filePath.split('.').pop().toLowerCase();
    let contentType = 'application/octet-stream';
    if (['mp3', 'wav'].includes(ext)) contentType = 'audio/mpeg';
    else if (['mp4', 'mkv', 'webm'].includes(ext)) contentType = 'video/mp4';
    else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    try {
        console.log(`[Pipeline] Fetching stream from ESP32 for: ${filePath}`);
        
        // ESP32 এর লোকাল সার্ভার থেকে ফাইলটির বাইনারি স্ট্রিম রিকোয়েস্ট করা হচ্ছে
        // (ধাপ ২ এর ESP32 কোডে আমরা এই '/raw-file' এন্ডপয়েন্টটি তৈরি করব)
        const esp32StreamUrl = `http://${cloudStorage.esp32Ip}/raw-file?path=${encodeURIComponent(filePath)}`;
        
        const response = await axios({
            method: 'get',
            url: esp32StreamUrl,
            responseType: 'stream',
            timeout: 30000 // ৩০ সেকেন্ড রিড টাইমআউট
        });

        // ব্রাউজারকে মিডিয়া টাইপ হেডারে জানানো
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${filePath.split('/').pop()}"`);

        // ইএসপি৩২ এর ডাটা সরাসরি ব্রাউজারে পাইপ (Pipe) করে দেওয়া হচ্ছে
        response.data.pipe(res);

    } catch (error) {
        console.error("[Pipeline Error] Failed to stream from ESP32:", error.message);
        res.status(500).send("Streaming failed. Ensure ESP32 is on the same local network as the proxy gateway.");
    }
});

// --- ৩. মিডিয়া প্লেয়ার ইন্টারফেস HTML ---
app.get('/view-file', requireAuth, (req, res) => {
    const filePath = req.query.path;
    const ext = filePath.split('.').pop().toLowerCase();
    let playerHtml = '';

    const streamUrl = `/stream-media?path=${encodeURIComponent(filePath)}`;

    if (['mp3', 'wav', 'ogg'].includes(ext)) {
        playerHtml = `<audio controls autoplay src="${streamUrl}" style="width:100%; max-width:500px;"></audio>`;
    } else if (['mp4', 'webm', 'mkv'].includes(ext)) {
        playerHtml = `<video controls autoplay src="${streamUrl}" style="width:100%; max-width:850px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5);"></video>`;
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        playerHtml = `<img src="${streamUrl}" style="max-width:100%; max-height:80vh; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5);"/>`;
    } else {
        playerHtml = `<div style="padding:20px; background:#1e293b; border-radius:8px;"><p>Preview not available for this file type.</p><a href="${streamUrl}" class="btn" download>📥 Download File</a></div>`;
    }

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Streaming Server</title>
        <style>
            body { margin:0; background:#0f172a; color:#fff; font-family:sans-serif; display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; padding:20px; box-sizing:border-box; }
            .nav { margin-bottom:20px; }
            .btn { padding:10px 20px; background:#1e293b; color:#38bdf8; text-decoration:none; border-radius:6px; border:1px solid #334155; font-weight:bold; }
            h3 { color:#94a3b8; text-align:center; word-break:break-all; max-width:600px; margin-bottom:25px; }
        </style>
    </head>
    <body>
        <div class="nav"><a class="btn" href="javascript:history.back()">⬅ Back to Cloud</a></div>
        <h3>Playing: ${filePath.split('/').pop()}</h3>
        ${playerHtml}
    </body>
    </html>
    `);
});

// --- ৪. লগইন রাউটস ---
app.get('/login', (req, res) => {
    if (req.signedCookies.isLoggedIn === 'true') return res.redirect('/');
    res.send(`
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Cloud Login</title><style>body{font-family:sans-serif;background:#090d16;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.card{background:#1e293b;padding:30px;border-radius:12px;width:100%;max-width:340px;}input,button{width:100%;padding:12px;margin:10px 0;border-radius:6px;border:1px solid #334155;box-sizing:border-box;}input{background:#0f172a;color:#fff;}button{background:#0284c7;color:white;font-weight:bold;border:none;cursor:pointer;}</style></head>
    <body><div class="card"><h2 style="color:#38bdf8;text-align:center;">Cloud Storage</h2><form action="/login" method="POST"><input type="text" name="username" placeholder="Username" required><input type="password" name="password" placeholder="Password" required><button type="submit">Unlock Portal</button></form></div></body>
    </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === adminCredentials.username && password === adminCredentials.password) {
        res.cookie('isLoggedIn', 'true', { maxAge: 86400000, signed: true, httpOnly: true });
        res.redirect('/');
    } else res.redirect('/login?error=true');
});

app.get('/logout', (req, res) => { res.clearCookie('isLoggedIn'); res.redirect('/login'); });

// --- ৫. মূল ড্যাশবোর্ড (ডাইনামিক ফোল্ডার ব্রাউজিং) ---
app.get('/', requireAuth, (req, res) => {
    const currentFolder = req.query.dir || '';
    
    let currentTree = cloudStorage.fileTree;
    if (currentFolder) {
        const parts = currentFolder.split('/').filter(p => p);
        for (const part of parts) {
            if (currentTree && currentTree[part]) currentTree = currentTree[part];
            else { currentTree = null; break; }
        }
    }

    let backFolder = '';
    if (currentFolder) {
        const parts = currentFolder.split('/').filter(p => p);
        parts.pop();
        backFolder = parts.join('/');
    }

    let folderItemsHtml = '';
    let fileItemsHtml = '';

    if (currentFolder) {
        folderItemsHtml += `
            <div class="item-card folder-card" onclick="location.href='?dir=${encodeURIComponent(backFolder)}'">
                <div class="icon">📁</div><div class="name">.. (Back)</div>
            </div>`;
    }

    if (currentTree) {
        Object.keys(currentTree).forEach(key => {
            if (key !== '_files') {
                const subFolderPath = currentFolder ? `${currentFolder}/${key}` : key;
                folderItemsHtml += `
                    <div class="item-card folder-card" onclick="location.href='?dir=${encodeURIComponent(subFolderPath)}'">
                        <div class="icon">📁</div><div class="name">${key}</div>
                    </div>`;
            }
        });

        if (currentTree._files) {
            currentTree._files.forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                let icon = '📄';
                if (['mp3', 'wav'].includes(ext)) icon = '🎵';
                else if (['mp4', 'mkv', 'webm'].includes(ext)) icon = '🎬';
                else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) icon = '🖼️';

                fileItemsHtml += `
                    <div class="item-card file-card" onclick="location.href='/view-file?path=${encodeURIComponent(file.fullPath)}'">
                        <div class="icon">${icon}</div><div class="name">${file.name}</div>
                    </div>`;
            });
        }
    }

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Personal Cloud</title>
        <style>
            :root { --bg:#0f172a; --card:#1e293b; --text:#f8fafc; --accent:#38bdf8; --border:rgba(255,255,255,0.05); }
            body { font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); margin:0; padding:20px; }
            .navbar { display:flex; justify-content:space-between; align-items:center; max-width:1000px; margin:0 auto 20px; }
            .main-container { max-width:1000px; margin:0 auto; }
            .storage-box { background:var(--card); padding:20px; border-radius:12px; border:1px solid var(--border); margin-bottom:20px; }
            .progress-bar { background:#334155; height:10px; border-radius:5px; overflow:hidden; margin-top:10px; }
            .progress-fill { background:var(--accent); height:100%; width:${cloudStorage.usedPercentage}%; }
            .path-bar { background:#1e293b; padding:12px; border-radius:8px; margin-bottom:20px; font-weight:bold; color:var(--accent); }
            .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:15px; }
            .item-card { background:var(--card); border:1px solid var(--border); padding:15px; border-radius:10px; text-align:center; cursor:pointer; transition:0.2s; }
            .item-card:hover { transform:translateY(-3px); border-color:var(--accent); }
            .icon { font-size:36px; margin-bottom:8px; }
            .name { font-size:14px; text-overflow:ellipsis; white-space:nowrap; overflow:hidden; }
            .logout-btn { padding:8px 16px; background:#ef4444; color:white; border:none; border-radius:6px; text-decoration:none; font-weight:bold; }
        </style>
    </head>
    <body>
        <div class="navbar"><h2>🛡️ Private Media Cloud</h2><a href="/logout" class="logout-btn">🔒 Logout</a></div>
        <div class="main-container">
            <div class="storage-box">
                <p style="margin:0 0 10px;">SD Card: ${cloudStorage.connected ? '🟢 Connected' : '🔴 Offline'} | Storage: ${cloudStorage.freeSpace} GB Free of ${cloudStorage.totalSpace} GB</p>
                <div class="progress-bar"><div class="progress-fill"></div></div>
            </div>
            <div class="path-bar">📁 Root / ${currentFolder}</div>
            <div class="grid">${folderItemsHtml === '' && fileItemsHtml === '' ? '<p style="grid-column:1/-1; text-align:center; color:gray;">Empty Folder</p>' : folderItemsHtml + fileItemsHtml}</div>
        </div>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`[Stream Pipeline Server] Running on port ${PORT}`));
