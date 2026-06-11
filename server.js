const express = require('express');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js'); // সুপাবেস ইন্টিগ্রেশন
const app = express();
const PORT = process.env.PORT || 10000;

// 🔥 আপনার Supabase Credentials এখানে বসান
const SUPABASE_URL = 'https://hvmipjfzqchdzujrxdyy.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_KZM6Cxd_TKynIeuOsyNxDw_x6ffZXcX';
const BUCKET_NAME = 'esp32-cache';
// সুপাবেস ক্লায়েন্ট ইনিশিয়ালাইজ করা
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// বড় মিডিয়া ফাইল (বেস-৬৪ চ্যাঙ্ক) রিসিভ করার জন্য মেমরি লিমিট ৫০ মেগাবাইট করা হলো
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser('esp32_cloud_secret_cookie_key'));

let cloudStorage = {
    connected: false,
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

// ফ্ল্যাট ফাইল পাথ থেকে ডাইনামিক ফোল্ডার ট্রি জেনারেট করা
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

// --- ১. ESP32 ডাটা ও ফাইল ক্যাশ রিসিভ করার মূল এপিআই (POST) ---
app.post('/api/ping', async (req, res) => {
    const { total, free, files, admin_u, admin_p, fileData, filePath } = req.body;
    
    cloudStorage.connected = true;
    cloudStorage.totalSpace = total || "0.00";
    cloudStorage.freeSpace = free || "0.00";
    
    if (files) cloudStorage.fileTree = buildFileTree(files);

    let totalNum = parseFloat(total);
    let freeNum = parseFloat(free);
    if (totalNum > 0) {
        cloudStorage.usedPercentage = Math.round(((totalNum - freeNum) / totalNum) * 100);
    }
    
    if (admin_u && admin_p) {
        adminCredentials.username = admin_u;
        adminCredentials.password = admin_p;
    }

    // 🚀 ESP32 থেকে আসা বাইনারি ডাটা সরাসরি Supabase-এ ওভাররাইট/ক্যাশ করা হচ্ছে
    if (filePath && fileData) {
        try {
            const fileBuffer = Buffer.from(fileData, 'base64');
            
            // একই নামের ফাইল থাকলে তা ওভাররাইট (upsert: true) হবে
            const { error } = await supabase.storage
                .from(BUCKET_NAME)
                .upload(filePath, fileBuffer, {
                    contentType: 'auto',
                    upsert: true 
                });

            if (error) console.error(`[Supabase Error] Upload failed:`, error.message);
            else console.log(`[Cloud Cache Sync] Cached & Secured: ${filePath}`);
        } catch (err) {
            console.error(`[Buffer Error]`, err.message);
        }
    }
    
    cloudStorage.lastUpdated = new Date().toLocaleTimeString();
    res.status(200).send("OK");
});

// --- ২. রিয়েল সিকিউর মিডিয়া স্ট্রিমিং ও ডাউনলোড পাইপলাইন (GET) ---
app.get('/stream-media', requireAuth, async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send("File path missing");

    try {
        // সুপাবেস প্রাইভেট বাকেট থেকে ফাইলটি স্ট্রিম আকারে নামিয়ে আনা হচ্ছে
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .download(filePath);

        if (error || !data) {
            return res.status(404).send("<h2>⏳ File is caching or not found...</h2><p>Please wait for ESP32 to sync.</p>");
        }

        // ব্রাউজারকে সঠিক কন্টেন্ট টাইপ প্রোভাইড করা যেন ডাউনলোড না হয়ে সরাসরি প্লে হয়
        const ext = filePath.split('.').pop().toLowerCase();
        let contentType = 'application/octet-stream';
        if (['mp3', 'wav'].includes(ext)) contentType = 'audio/mpeg';
        else if (['mp4', 'webm', 'mkv'].includes(ext)) contentType = 'video/mp4';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.end(buffer);

    } catch (err) {
        console.error("[Stream Error]", err.message);
        res.status(500).send("Streaming pipeline failure.");
    }
});

// --- ৩. মিডিয়া প্লেয়ার ইন্টারফেস HTML ---
app.get('/view-file', requireAuth, (req, res) => {
    const filePath = req.query.path;
    const ext = filePath.split('.').pop().toLowerCase();
    let playerHtml = '';

    const streamUrl = `/stream-media?path=${encodeURIComponent(filePath)}`;

    if (['mp3', 'wav'].includes(ext)) {
        playerHtml = `<audio controls autoplay src="${streamUrl}" style="width:100%; max-width:500px;"></audio>`;
    } else if (['mp4', 'webm', 'mkv'].includes(ext)) {
        playerHtml = `<video controls autoplay src="${streamUrl}" style="width:100%; max-width:850px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5);"></video>`;
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        playerHtml = `<img src="${streamUrl}" style="max-width:100%; max-height:80vh; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5);"/>`;
    } else {
        playerHtml = `<div style="padding:20px; background:#1e293b; border-radius:8px;"><p>No preview. Available for secure download:</p><a href="${streamUrl}" class="btn" download>📥 Download File</a></div>`;
    }

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Stream Core</title>
        <style>
            body { margin:0; background:#0f172a; color:#fff; font-family:sans-serif; display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; padding:20px; box-sizing:border-box; }
            .nav { margin-bottom:20px; }
            .btn { padding:10px 20px; background:#1e293b; color:#38bdf8; text-decoration:none; border-radius:6px; border:1px solid #334155; font-weight:bold; }
            h3 { color:#94a3b8; text-align:center; word-break:break-all; }
        </style>
    </head>
    <body>
        <div class="nav"><a class="btn" href="javascript:history.back()">⬅ Back to Cloud</a></div>
        <h3>Streaming: ${filePath.split('/').pop()}</h3>
        ${playerHtml}
    </body>
    </html>
    `);
});

// --- ৪. লগইন এবং ড্যাশবোর্ড (কানেক্টেড স্টেট হ্যান্ডলিং) ---
app.get('/login', (req, res) => {
    res.send(`
    <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Login</title><style>body{background:#090d16;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}.card{background:#1e293b;padding:30px;border-radius:12px;width:320px;}input,button{width:100%;padding:12px;margin:10px 0;border-radius:6px;border:1px solid #334155;}button{background:#0284c7;color:#fff;font-weight:bold;border:none;cursor:pointer;}</style></head>
    <body><div class="card"><h2>Cloud Login</h2><form action="/login" method="POST"><input type="text" name="username" placeholder="Username" required><input type="password" name="password" placeholder="Password" required><button type="submit">Unlock</button></form></div></body></html>
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

app.get('/', requireAuth, (req, res) => {
    // যদি ESP32 ডিসকানেক্টেড থাকে, ফ্রন্টএন্ডে সিকোয়েন্স হাইড হয়ে যাবে
    if (!cloudStorage.connected) {
        return res.send(`
        <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Cloud Portal</title><style>body{background:#0f172a;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0; text-align:center;}</style></head>
        <body><div><h2>🔒 Cloud Storage Locked</h2><p style="color:gray;">ESP32 Hardware Module or SD Card is disconnected. Connect the module to browse files.</p></div></body></html>
        `);
    }

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
        folderItemsHtml += `<div class="item-card folder-card" onclick="location.href='?dir=${encodeURIComponent(backFolder)}'"><div class="icon">📁</div><div class="name">.. (Back)</div></div>`;
    }

    if (currentTree) {
        // ফোল্ডার সিকোয়েন্স রেন্ডার
        Object.keys(currentTree).forEach(key => {
            if (key !== '_files') {
                const subFolderPath = currentFolder ? `${currentFolder}/${key}` : key;
                folderItemsHtml += `<div class="item-card folder-card" onclick="location.href='?dir=${encodeURIComponent(subFolderPath)}'"><div class="icon">📁</div><div class="name">${key}</div></div>`;
            }
        });

        // ফাইল সিকোয়েন্স রেন্ডার
        if (currentTree._files) {
            currentTree._files.forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                let icon = '📄';
                if (['mp3', 'wav'].includes(ext)) icon = '🎵';
                else if (['mp4', 'mkv', 'webm'].includes(ext)) icon = '🎬';
                else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) icon = '🖼️';

                fileItemsHtml += `<div class="item-card file-card" onclick="location.href='/view-file?path=${encodeURIComponent(file.fullPath)}'"><div class="icon">${icon}</div><div class="name">${file.name}</div></div>`;
            });
        }
    }

    res.send(`
    <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Cloud Portal</title><style>:root{--bg:#0f172a;--card:#1e293b;--text:#f8fafc;--accent:#38bdf8;--border:rgba(255,255,255,0.05);}body{font-family:sans-serif;background:var(--bg);color:var(--text);margin:0;padding:20px;}.navbar{display:flex;justify-content:space-between;align-items:center;max-width:1000px;margin:0 auto 20px;}.main-container{max-width:1000px;margin:0 auto;}.storage-box{background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border);margin-bottom:20px;}.progress-bar{background:#334155;height:10px;border-radius:5px;overflow:hidden;margin-top:10px;}.progress-fill{background:var(--accent);height:100%;width:${cloudStorage.usedPercentage}%;}.path-bar{background:#1e293b;padding:12px;border-radius:8px;margin-bottom:20px;font-weight:bold;color:var(--accent);}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:15px;}.item-card{background:var(--card);border:1px solid var(--border);padding:15px;border-radius:10px;text-align:center;cursor:pointer;transition:0.2s;}.item-card:hover{border-color:var(--accent);transform:translateY(-2px);}.icon{font-size:32px;margin-bottom:6px;}.name{font-size:13px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;}.logout-btn{padding:8px 16px;background:#ef4444;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;}</style></head>
    <body><div class="navbar"><h2>🛡️ Private Cache Cloud</h2><a href="/logout" class="logout-btn">Logout</a></div><div class="main-container"><div class="storage-box"><p style="margin:0 0 10px;">SD Status: 🟢 Connected | Capacity: ${cloudStorage.freeSpace} GB Free of ${cloudStorage.totalSpace} GB</p><div class="progress-bar"><div class="progress-fill"></div></div></div><div class="path-bar">📁 Current Directory: Root / ${currentFolder}</div><div class="grid">${folderItemsHtml === '' && fileItemsHtml === '' ? '<p>Empty Folder</p>' : folderItemsHtml + fileItemsHtml}</div></div></body></html>
    `);
});

app.listen(PORT, () => console.log(`[Supabase Proxy Gateway] Active on port ${PORT}`));
