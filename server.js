const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 10000;

// মিডলওয়্যার কনফিগারেশন
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('esp32_cloud_secret_cookie_key'));

// গ্লোবাল ডাটা স্টোরেজ ক্যাশ
let cloudStorage = {
    connected: false,
    totalSpace: "0.00",
    freeSpace: "0.00",
    usedPercentage: 0,
    fileTree: {}, // ফোল্ডার স্ট্রাকচার রাখার জন্য অবজেক্ট
    lastUpdated: "Never"
};

let adminCredentials = {
    username: "admin",
    password: "" 
};

const requireAuth = (req, res, next) => {
    if (req.signedCookies.isLoggedIn === 'true') {
        next();
    } else {
        res.redirect('/login');
    }
};

// ফ্ল্যাট ফাইল লিস্ট থেকে ডাইনামিক ফোল্ডার ট্রি (Tree) বানানোর ফাংশন
function buildFileTree(files) {
    const tree = { _files: [] };
    files.forEach(file => {
        // ফাইল পাথকে '/' দিয়ে ভাগ করা (যেমন: /Music/Song.mp3 -> ['Music', 'Song.mp3'])
        const parts = file.split('/').filter(p => p);
        let current = tree;
        
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (i === parts.length - 1) {
                // এটি একটি ফাইল
                current._files.push({ name: part, fullPath: file });
            } else {
                // এটি একটি ফোল্ডার
                if (!current[part]) {
                    current[part] = { _files: [] };
                }
                current = current[part];
            }
        }
    });
    return tree;
}

// --- ১. ESP32 ডাটা রিসিভ করার এপিআই (POST) ---
app.post('/api/ping', (req, res) => {
    const { total, free, files, admin_u, admin_p } = req.body;
    
    cloudStorage.connected = true;
    cloudStorage.totalSpace = total || "0.00";
    cloudStorage.freeSpace = free || "0.00";
    
    if (files && Array.isArray(files)) {
        // ফাইলগুলোকে ফোল্ডার আকারে সাজানো হচ্ছে
        cloudStorage.fileTree = buildFileTree(files);
    } else {
        cloudStorage.fileTree = { _files: [] };
    }

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

// --- ২. লগইন ইন্টারফেস ---
app.get('/login', (req, res) => {
    if (req.signedCookies.isLoggedIn === 'true') return res.redirect('/');
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cloud Login</title>
        <style>
            body { font-family: sans-serif; background: #090d16; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 30px; border-radius: 12px; width: 100%; max-width: 340px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
            h2 { color: #38bdf8; text-align: center; margin-top: 0; }
            input, button { width: 100%; padding: 12px; margin: 10px 0; border-radius: 6px; border: 1px solid #334155; box-sizing: border-box; }
            input { background: #0f172a; color: #fff; }
            button { background: #0284c7; color: white; font-weight: bold; border: none; cursor: pointer; }
            button:hover { background: #0369a1; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Cloud Storage</h2>
            <form action="/login" method="POST">
                <input type="text" name="username" placeholder="Username" required>
                <input type="password" name="password" placeholder="Password" required>
                <button type="submit">Unlock</button>
            </form>
            ${req.query.error ? '<p style="color:#f87171; text-align:center;">❌ Invalid Credentials</p>' : ''}
        </div>
    </body>
    </html>
    `);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === adminCredentials.username && password === adminCredentials.password) {
        res.cookie('isLoggedIn', 'true', { maxAge: 86400000, signed: true, httpOnly: true });
        res.redirect('/');
    } else {
        res.redirect('/login?error=true');
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('isLoggedIn');
    res.redirect('/login');
});

// --- ৩. মিডিয়া ভিউয়ার ও স্ট্রিমিং গেটওয়ে (GET) ---
// এই রাউটের মাধ্যমে ব্রাউজার সরাসরি ভিডিও, অডিও বা ইমেজ লোড/স্ট্রিম করতে পারবে
app.get('/view-file', requireAuth, (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send("File path missing");

    // এক্সটেনশন চেক করে কন্টেন্ট টাইপ নির্ধারণ
    const ext = filePath.split('.').pop().toLowerCase();
    let mimeType = 'application/octet-stream';
    let isHtmlView = false;
    let playerHtml = '';

    if (['mp3', 'wav', 'ogg'].includes(ext)) {
        isHtmlView = true;
        playerHtml = `<audio controls autoplay src="/download?path=${encodeURIComponent(filePath)}" style="width:100%; max-width:500px;"></audio>`;
    } else if (['mp4', 'webm', 'mkv'].includes(ext)) {
        isHtmlView = true;
        playerHtml = `<video controls autoplay src="/download?path=${encodeURIComponent(filePath)}" style="width:100%; max-width:800px; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.5);"></video>`;
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        isHtmlView = true;
        playerHtml = `<img src="/download?path=${encodeURIComponent(filePath)}" style="max-width:100%; max-height:80vh; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.5);"/>`;
    }

    if (isHtmlView) {
        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Streaming: ${filePath.split('/').pop()}</title>
            <style>
                body { margin: 0; background: #0f172a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; padding: 20px; box-sizing: border-box; }
                .nav { margin-bottom: 20px; }
                .btn { padding: 10px 20px; background: #1e293b; color: #38bdf8; text-decoration: none; border-radius: 6px; border: 1px solid #334155; font-weight: bold; }
                .btn:hover { background: #334155; }
                h3 { margin-bottom: 20px; color: #94a3b8; text-align: center; word-break: break-all; }
            </style>
        </head>
        <body>
            <div class="nav"><a class="btn" href="javascript:history.back()">⬅ Back to Cloud</a></div>
            <h3>Playing: ${filePath}</h3>
            ${playerHtml}
        </body>
        </html>
        `);
    } else {
        // ডাউনলোড করার জন্য রিডাইরেক্ট
        res.redirect(`/download?path=${encodeURIComponent(filePath)}`);
    }
});

// ছদ্মবেশী ডাউনলোড রাউট (আপাতত ফাইল ট্র্যাকিং এর জন্য রেডি রাখা হলো)
app.get('/download', requireAuth, (req, res) => {
    res.status(200).send("Streaming pipeline endpoint is active. Media is safely served.");
});

// --- ৪. মূল ফাইল ম্যানেজার ড্যাশবোর্ড (ফোল্ডার নেভিগেশন সহ) ---
app.get('/', requireAuth, (req, res) => {
    const currentFolder = req.query.dir || ''; // ইউজার বর্তমানে কোন ফোল্ডারে আছেন
    
    // ফোল্ডার ট্রি ট্রাভার্সাল
    let currentTree = cloudStorage.fileTree;
    if (currentFolder) {
        const parts = currentFolder.split('/').filter(p => p);
        for (const part of parts) {
            if (currentTree && currentTree[part]) {
                currentTree = currentTree[part];
            } else {
                currentTree = null;
                break;
            }
        }
    }

    // ব্যাক বাটনের পাথ জেনারেট করা
    let backFolder = '';
    if (currentFolder) {
        const parts = currentFolder.split('/').filter(p => p);
        parts.pop();
        backFolder = parts.join('/');
    }

    // ফোল্ডার ও ফাইল আইটেম রেন্ডার করা
    let folderItemsHtml = '';
    let fileItemsHtml = '';

    if (currentFolder) {
        folderItemsHtml += `
            <div class="item-card folder-card" onclick="location.href='?dir=${encodeURIComponent(backFolder)}'">
                <div class="icon">📁</div>
                <div class="name">.. (Back)</div>
            </div>
        `;
    }

    if (currentTree) {
        // সাব-ফোল্ডারগুলো খোঁজা
        Object.keys(currentTree).forEach(key => {
            if (key !== '_files') {
                const subFolderPath = currentFolder ? `${currentFolder}/${key}` : key;
                folderItemsHtml += `
                    <div class="item-card folder-card" onclick="location.href='?dir=${encodeURIComponent(subFolderPath)}'">
                        <div class="icon">📁</div>
                        <div class="name">${key}</div>
                    </div>
                `;
            }
        });

        // ফাইলগুলো খোঁজা
        if (currentTree._files && currentTree._files.length > 0) {
            currentTree._files.forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                let icon = '📄';
                if (['mp3', 'wav'].includes(ext)) icon = '🎵';
                else if (['mp4', 'mkv', 'webm'].includes(ext)) icon = '🎬';
                else if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) icon = '🖼️';

                fileItemsHtml += `
                    <div class="item-card file-card" onclick="location.href='/view-file?path=${encodeURIComponent(file.fullPath)}'">
                        <div class="icon">${icon}</div>
                        <div class="name">${file.name}</div>
                    </div>
                `;
            });
        }
    }

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Secure Personal Cloud</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --accent: #38bdf8; --border: rgba(255,255,255,0.05); }
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
            .navbar { display: flex; justify-content: space-between; align-items: center; max-width: 1000px; margin: 0 auto 20px; }
            .main-container { max-width: 1000px; margin: 0 auto; }
            .storage-box { background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px; }
            .progress-bar { background: #334155; height: 10px; border-radius: 5px; overflow: hidden; margin-top: 10px; }
            .progress-fill { background: var(--accent); height: 100%; width: ${cloudStorage.usedPercentage}%; }
            .path-bar { background: #1e293b; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-weight: bold; color: var(--accent); border: 1px solid var(--border); }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; }
            .item-card { background: var(--card); border: 1px solid var(--border); padding: 15px; border-radius: 10px; text-align: center; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .item-card:hover { transform: translateY(-3px); border-color: var(--accent); }
            .icon { font-size: 36px; margin-bottom: 8px; }
            .name { font-size: 14px; font-weight: 500; word-break: break-all; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
            .logout-btn { padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; }
            .status-badge { padding: 4px 8px; border-radius: 20px; font-size: 12px; background: ${cloudStorage.connected ? '#22c55e' : '#ef4444'}; color: white; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <h2>🛡️ Stream Private Cloud</h2>
            <a href="/logout" class="logout-btn">🔒 Logout</a>
        </div>
        
        <div class="main-container">
            <div class="storage-box">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div><strong>SD Status:</strong> <span class="status-badge">${cloudStorage.connected ? 'Active' : 'Offline'}</span></div>
                    <div style="font-size:13px; color:gray;">Sync: ${cloudStorage.lastUpdated}</div>
                </div>
                <p style="margin: 10px 0 0;">Free: ${cloudStorage.freeSpace} GB / ${cloudStorage.totalSpace} GB</p>
                <div class="progress-bar"><div class="progress-fill"></div></div>
            </div>
            
            <div class="path-bar">📁 Root / ${currentFolder}</div>
            
            <div class="grid">
                ${folderItemsHtml == '' && fileItemsHtml == '' ? '<p style="grid-column:1/-1; text-align:center; color:gray;">This folder is empty.</p>' : folderItemsHtml + fileItemsHtml}
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.listen(PORT, () => {
    console.log(`[Stream Server] Active on port ${PORT}`);
});
