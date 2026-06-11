const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// মিডলওয়্যার (JSON পেলোড রিসিভ করার জন্য অত্যাবশ্যকীয়)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// গ্লোবাল ড্যাশবোর্ড ডাটা ক্যাশ
let sdCardStatus = {
    connected: false,
    totalSpace: "0.00",
    freeSpace: "0.00",
    usedPercentage: 0,
    fileList: [],
    lastUpdated: "Never"
};

// ১. ESP32 থেকে আসা POST JSON ডাটা হ্যান্ডেল করার এপিআই
app.post('/api/ping', (req, res) => {
    const { total, free, files } = req.body;
    
    sdCardStatus.connected = true;
    sdCardStatus.totalSpace = total || "0.00";
    sdCardStatus.freeSpace = free || "0.00";
    
    // ফাইল লিস্ট অ্যারে রিসিভ করা
    if (files && Array.isArray(files)) {
        sdCardStatus.fileList = files;
    } else {
        sdCardStatus.fileList = [];
    }

    // স্টোরেজ বার ক্যালকুলেশন
    let totalNum = parseFloat(total);
    let freeNum = parseFloat(free);
    if (totalNum > 0) {
        sdCardStatus.usedPercentage = Math.round(((totalNum - freeNum) / totalNum) * 100);
    }
    
    sdCardStatus.lastUpdated = new Date().toLocaleTimeString();
    console.log(`[ESP32 Sync] Received ${sdCardStatus.fileList.length} files at ${sdCardStatus.lastUpdated}`);
    
    res.status(200).json({ status: "success", message: "Cloud Cache Updated" });
});

// ২. মূল ক্লাউড ফাইল ম্যানেজার ড্যাশবোর্ড ইন্টারফেস (HTML, CSS, JS)
app.get('/', (req, res) => {
    // প্রতিটা ফাইলের জন্য মডার্ন গ্রিড আইটেম জেনারেট করা
    const fileItems = sdCardStatus.fileList.map(file => `
        <div class="file-card">
            <div class="file-icon">📄</div>
            <div class="file-name">${file}</div>
            <div class="file-actions">
                <button onclick="alert('Downloading: ${file}')">Download</button>
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
            .file-card { background: var(--card); border: 1px solid var(--border); padding: 15px; border-radius: 10px; text-align: center; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
            .file-icon { font-size: 40px; margin-bottom: 10px; }
            .file-name { font-weight: 500; font-size: 15px; word-break: break-all; margin-bottom: 15px; }
            
            .file-actions button { padding: 6px 14px; background: var(--accent); border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold; }
            .btn-theme { padding: 8px 16px; background: var(--card); border: 1px solid var(--border); color: var(--text); border-radius: 8px; cursor: pointer; font-weight: bold; }
            .status-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; background: ${sdCardStatus.connected ? '#22c55e' : '#ef4444'}; color: white; }
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
                    <div style="font-size: 14px; color: gray;">Last Updated: ${sdCardStatus.lastUpdated}</div>
                </div>
                <p style="margin: 15px 0 5px;">Storage: ${sdCardStatus.freeSpace} GB Free of ${sdCardStatus.totalSpace} GB (${sdCardStatus.usedPercentage}% Used)</p>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
            
            <h3>Files on SD Card</h3>
            <div class="file-grid">
                ${sdCardStatus.fileList.length === 0 ? '<p style="grid-column: 1/-1; text-align:center; color:gray; padding: 20px;">No files found or SD Card is empty.</p>' : fileItems}
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

app.listen(PORT, () => {
    console.log(`[Server] Live on port ${PORT}`);
});
