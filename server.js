const express = require('express');
const app = express();
const path = require('path');
const PORT = process.env.PORT || 3000;

// মিডলওয়্যার সেটআপ (ডাটা পার্স করার জন্য)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// গ্লোবাল ভ্যারিয়েবল (ESP32 থেকে আসা এসডি কার্ডের ডাটা এখানে সেভ থাকবে)
let sdCardStatus = {
    connected: false,
    totalSpace: "0.00",
    freeSpace: "0.00",
    usedPercentage: 0,
    fileList: [],
    lastUpdated: "Never"
};

// ১. ESP32-এর জন্য পিং এবং ডাটা রিসিভ API
app.get('/api/ping', (req, res) => {
    // ESP32 যখন পিং করবে, সে ইউআরএল প্যারামিটার বা হেডারে ডাটা পাঠাতে পারবে
    // উদাহরণ: /api/ping?total=32.00&free=10.50
    if (req.query.total && req.query.free) {
        sdCardStatus.connected = true;
        sdCardStatus.totalSpace = req.query.total;
        sdCardStatus.freeSpace = req.query.free;
        
        let total = parseFloat(req.query.total);
        let free = parseFloat(req.query.free);
        if (total > 0) {
            sdCardStatus.usedPercentage = Math.round(((total - free) / total) * 100);
        }
        
        sdCardStatus.lastUpdated = new Date().toLocaleTimeString();
    }
    
    console.log(`[ESP32 Ping] Received at ${sdCardStatus.lastUpdated}`);
    res.status(200).send("Server is awake, ESP32!");
});

// ২. ফাইল লিস্ট আপডেট করার জন্য আলাদা API (ESP32 এটি ব্যবহার করবে)
app.post('/api/update-files', (express.json()), (req, res) => {
    if (req.body && req.body.files) {
        sdCardStatus.fileList = req.body.files; // এক্সপেক্টেড: ["song.mp3", "pic.jpg"]
        console.log("[ESP32 Data] File list updated successfully.");
        return res.status(200).json({ status: "success" });
    }
    res.status(400).send("Invalid Data");
});

// ৩. ওয়েব ইন্টারফেস (HTML, CSS, JS একসাথেই দেওয়া হলো সহজে হোস্ট করার জন্য)
app.get('/', (req, res) => {
    // এখানে আমরা একটি ডাইনামিক পেজ জেনারেট করছি যা এসডি কার্ডের লাইভ ডাটা দেখাবে
    const fileItems = sdCardStatus.fileList.map(file => `
        <div class="file-card">
            <div class="file-icon">📄</div>
            <div class="file-name">${file}</div>
            <div class="file-actions">
                <button onclick="alert('Streaming: ${file}')">Play</button>
                <button class="btn-delete" onclick="alert('Deleting: ${file}')">Delete</button>
            </div>
        </div>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cloud File Manager</title>
        <style>
            :root { --bg: #0f172a; --card: #1e293b; --text: #f8fafc; --accent: #38bdf8; --border: rgba(255,255,255,0.05); }
            .light-theme { --bg: #f1f5f9; --card: #ffffff; --text: #0f172a; --accent: #0284c7; --border: rgba(0,0,0,0.05); }
            
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; transition: 0.3s; }
            .navbar { display: flex; justify-content: space-between; align-items: center; max-width: 1000px; margin: 0 auto 30px; }
            .main-container { max-width: 1000px; margin: 0 auto; display: grid; grid-template-columns: 1fr; gap: 20px; }
            
            .storage-box { background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
            .progress-bar { background: #334155; height: 12px; border-radius: 6px; overflow: hidden; margin-top: 10px; }
            .progress-fill { background: var(--accent); height: 100%; width: ${sdCardStatus.usedPercentage}%; transition: 0.5s; }
            
            .file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 15px; margin-top: 20px; }
            .file-card { background: var(--card); border: 1px solid var(--border); padding: 15px; border-radius: 10px; text-align: center; position: relative; }
            .file-icon { font-size: 40px; margin-bottom: 10px; }
            .file-name { font-weight: 500; font-size: 15px; word-break: break-all; margin-bottom: 15px; }
            
            .file-actions button { padding: 6px 12px; background: var(--accent); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 13px; margin: 2px; }
            .file-actions .btn-delete { background: #ef4444; }
            
            .btn-theme { padding: 8px 16px; background: var(--card); border: 1px solid var(--border); color: var(--text); border-radius: 8px; cursor: pointer; font-weight: bold; }
            .status-badge { display: inline-block; padding: 4px 8px; border-radius: 20px; font-size: 12px; font-weight: bold; background: ${sdCardStatus.connected ? '#22c55e' : '#ef4444'}; color: white; }
        </style>
    </head>
    <body>
        <div class="navbar">
            <h2>☁️ Cloud File Manager</h2>
            <button class="btn-theme" onclick="toggleTheme()">🌓 Toggle Theme</button>
        </div>
        
        <div class="main-container">
            <div class="storage-box">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>SD Card Status:</strong> 
                        <span class="status-badge">${sdCardStatus.connected ? 'Connected' : 'Disconnected'}</span>
                    </div>
                    <div style="font-size: 14px; color: gray;">Last Ping: ${sdCardStatus.lastUpdated}</div>
                </div>
                <p style="margin: 15px 0 5px;">Storage: ${sdCardStatus.freeSpace} GB Free of ${sdCardStatus.totalSpace} GB</p>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
            
            <h3>Files on SD Card</h3>
            <div class="file-grid">
                ${sdCardStatus.fileList.length === 0 ? '<p style="grid-column: 1/-1; text-align:center; color:gray;">No files found or ESP32 offline.</p>' : fileItems}
            </div>
        </div>

        <script>
            // থিম টগল করার জাভাস্ক্রিপ্ট (ব্রাউজার মেমরিতে সেভ থাকবে)
            if (localStorage.getItem('theme') === 'light') {
                document.body.classList.add('light-theme');
            }
            function toggleTheme() {
                document.body.classList.toggle('light-theme');
                if (document.body.classList.contains('light-theme')) {
                    localStorage.setItem('theme', 'light');
                } else {
                    localStorage.setItem('theme', 'dark');
                }
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// সার্ভার স্টার্ট
app.listen(PORT, () => {
    console.log(`[Server] Running smoothly on port ${PORT}`);
});