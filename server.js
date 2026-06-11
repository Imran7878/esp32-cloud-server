const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// মিডলওয়্যার কনফিগারেশন
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('esp32_cloud_secret_cookie_key')); // সিকিউর কুকি সাইন করার জন্য

// গ্লোবাল ড্যাশবোর্ড ও ক্রেডেনশিয়াল ক্যাশ
let cloudStorage = {
    connected: false,
    totalSpace: "0.00",
    freeSpace: "0.00",
    usedPercentage: 0,
    fileList: [],
    lastUpdated: "Never"
};

// ডিফল্ট অ্যাডমিন ক্রেডেনশিয়াল (প্রথমবার সিঙ্ক হওয়ার আগ পর্যন্ত)
let adminCredentials = {
    username: "admin",
    password: "" // ESP32 সেটআপ পোর্টাল থেকে ডাটা আসার পর এটি অটো আপডেট হবে
};

// --- সিকিউরিটি মিডলওয়্যার (ইউজার লগইন অবস্থা চেক করার জন্য) ---
const requireAuth = (req, res, next) => {
    if (req.signedCookies.isLoggedIn === 'true') {
        next();
    } else {
        res.redirect('/login');
    }
};

// --- ১. ESP32 থেকে আসা ডাটা রিসিভ করার সিকিউর POST API ---
app.post('/api/ping', (req, res) => {
    const { total, free, files, admin_u, admin_p } = req.body;
    
    cloudStorage.connected = true;
    cloudStorage.totalSpace = total || "0.00";
    cloudStorage.freeSpace = free || "0.00";
    
    // ফাইল লিস্ট আপডেট
    if (files && Array.isArray(files)) {
        cloudStorage.fileList = files;
    } else {
        cloudStorage.fileList = [];
    }

    // স্টোরেজ বার পারসেন্টেজ ক্যালকুলেশন
    let totalNum = parseFloat(total);
    let freeNum = parseFloat(free);
    if (totalNum > 0) {
        cloudStorage.usedPercentage = Math.round(((totalNum - freeNum) / totalNum) * 100);
    }
    
    // ইএসপি৩২ এর সেটআপ পোর্টাল থেকে ইউজার ও পাসওয়ার্ড ডাটা আপডেট করা
    if (admin_u && admin_p) {
        adminCredentials.username = admin_u;
        adminCredentials.password = admin_p;
        console.log(`[Security Sync] Admin Credentials Updated Sync via ESP32`);
    }
    
    cloudStorage.lastUpdated = new Date().toLocaleTimeString();
    console.log(`[ESP32 Sync Received] Files Count: ${cloudStorage.fileList.length} at ${cloudStorage.lastUpdated}`);
    
    res.status(200).json({ status: "success", message: "Server database synchronized successfully" });
});

// --- ২. লগইন ইন্টারফেস (GET /login) ---
app.get('/login', (req, res) => {
    // ইউজার যদি অলরেডি লগইন থাকে, তাকে মেইন ড্যাশবোর্ডে পাঠিয়ে দেবে
    if (req.signedCookies.isLoggedIn === 'true') {
        return res.redirect('/');
    }

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cloud Secure Gateway - Login</title>
        <style>
            :root { --bg: #090d16; --card: rgba(30, 41, 59, 0.7); --accent: #38bdf8; --text: #f8fafc; --text-muted: #94a3b8; }
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 90vh; margin:0; }
            .card { background: var(--card); backdrop-filter: blur(10px); padding: 40px; border-radius: 16px; width: 100%; max-width: 360px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.05); }
            h2 { text-align: center; color: var(--accent); margin-bottom: 5px; font-weight: 600; font-size: 24px; }
            .subtitle { text-align: center; color: var(--text-muted); font-size: 13px; margin-bottom: 25px; }
            label { display: block; margin: 15px 0 6px; font-size: 14px; color: #cbd5e1; }
            input { width: 100%; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #fff; box-sizing: border-box; font-size: 14px; transition: 0.3s; }
            input:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 10px rgba(56, 189, 248, 0.2); }
            button { width: 100%; padding: 14px; background: linear-gradient(135deg, #0284c7, #0369a1); border: none; border-radius: 8px; color: white; font-weight: bold; font-size: 15px; margin-top: 25px; cursor: pointer; transition: 0.3s; box-shadow: 0 4px 15px rgba(2, 132, 199, 0.3); }
            button:hover { background: linear-gradient(135deg, #0369a1, #075985); transform: translateY(-1px); }
            .error-msg { color: #f87171; text-align: center; font-size: 13px; margin-top: 15px; font-weight: 500; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Cloud Storage</h2>
            <div class="subtitle">Enter credentials to access private server</div>
            <form action="/login" method="POST">
                <label>Username</label>
                <input type="text" name="username" required autocomplete="off" placeholder="Enter username">
                <label>Password</label>
                <input type="password" name="password" required placeholder="Enter password">
                <button type="submit">Unlock Dashboard</button>
            </form>
            ${req.query.error ? `<div class="error-msg">❌ Invalid Username or Password!</div>` : ''}
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// --- ৩. লগইন ভেরিফিকেশন অ্যাকশন (POST /login) ---
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    // ইউজারনেম এবং পাসওয়ার্ড ম্যাচিং চেক
    if (username === adminCredentials.username && password === adminCredentials.password) {
        // ২৪ ঘণ্টার জন্য সিকিউর সাইনড কুকি সেশন তৈরি করা
        res.cookie('isLoggedIn', 'true', { maxAge: 86400000, signed: true, httpOnly: true });
        res.redirect('/');
    } else {
        res.redirect('/login?error=true');
    }
});

// --- ৪. লগআউট অ্যাকশন (GET /logout) ---
app.get('/logout', (req, res) => {
    res.clearCookie('isLoggedIn');
    res.redirect('/login');
});

// --- ৫. মূল ক্লাউড ফাইল ম্যানেজার ড্যাশবোর্ড (পাসওয়ার্ড দ্বারা সুরক্ষিত - requireAuth) ---
app.get('/', requireAuth, (req, res) => {
    
    // প্রতিটা ফাইলের জন্য মডার্ন গ্রিড কার্ড তৈরি
    const fileItems = cloudStorage.fileList.map(file => `
        <div class="file-card">
            <div class="file-icon">📄</div>
            <div class="file-name">${file}</div>
            <div class="file-actions">
                <button onclick="alert('Secure Link Ready: Download Action for ${file}')">Download</button>
            </div>
        </div>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Secure Cloud Portal</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --accent: #38bdf8; --border: rgba(255,255,255,0.05); }
            .light-theme { --bg: #f1f5f9; --card: #ffffff; --text: #0f172a; --accent: #0284c7; --border: rgba(0,0,0,0.05); }
            
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; transition: 0.3s; }
            .navbar { display: flex; justify-content: space-between; align-items: center; max-width: 1000px; margin: 0 auto 30px; }
            .main-container { max-width: 1000px; margin: 0 auto; display: grid; grid-template-columns: 1fr; gap: 20px; }
            
            .storage-box { background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            .progress-bar { background: #334155; height: 12px; border-radius: 6px; overflow: hidden; margin-top: 10px; }
            .progress-fill { background: var(--accent); height: 100%; width: ${cloudStorage.usedPercentage}%; transition: 0.5s; }
            
            .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px; margin-top: 20px; }
            .file-card { background: var(--card); border: 1px solid var(--border); padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
            .file-icon { font-size: 40px; margin-bottom: 10px; }
            .file-name { font-weight: 500; font-size: 15px; word-break: break-all; margin-bottom: 15px; }
            
            .file-actions button { padding: 6px 14px; background: var(--accent); border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; }
            .btn-action { padding: 8px 16px; background: var(--card); border: 1px solid var(--border); color: var(--text); border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; text-decoration: none; display: inline-block; }
            .logout-btn { background: #ef4444 !important; color: white; border: none; }
            .status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; background: ${cloudStorage.connected ? '#22c55e' : '#ef4444'}; color: white; }
            .btn-group { display: flex; gap: 10px; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <h2>🛡️ Secure Private Cloud</h2>
            <div class="btn-group">
                <button class="btn-action" onclick="toggleTheme()">🌓 Theme</button>
                <a href="/logout" class="btn-action logout-btn">🔒 Logout</a>
            </div>
        </div>
        
        <div class="main-container">
            <div class="storage-box">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>SD Card System:</strong> 
                        <span class="status-badge">${cloudStorage.connected ? 'Connected' : 'Disconnected'}</span>
                    </div>
                    <div style="font-size: 14px; color: gray;">Last Synced: ${cloudStorage.lastUpdated}</div>
                </div>
                <p style="margin: 15px 0 5px;">Storage Capacity: ${cloudStorage.freeSpace} GB Free of ${cloudStorage.totalSpace} GB (${cloudStorage.usedPercentage}% Full)</p>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
            
            <h3>🔒 Your Private Files</h3>
            <div class="file-grid">
                ${cloudStorage.fileList.length === 0 ? '<p style="grid-column: 1/-1; text-align:center; color:gray; padding: 20px;">No files synched yet. Ensure your ESP32 is powered on and configured.</p>' : fileItems}
            </div>
        </div>

        <script>
            if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-theme');
            function toggleTheme() {
                document.body.classList.toggle('light-theme');
                localStorage.setItem('theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// সার্ভার লিসেনিং পোর্ট
app.listen(PORT, () => {
    console.log(`[Secure Server] Active and running on port ${PORT}`);
});
