const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const ftp = require("basic-ftp");
const cors = require("cors");
const path = require("path");
const { Readable } = require("stream"); // 👈 Needed for FTP upload

const app = express();
const PORT = process.env.PORT || 5000;

// 🛡️ Middleware
app.use(cors());
app.use(express.json());

// 🗂️ Use Multer with memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 🐬 MySQL Database Config
const db = mysql.createPool({
  host: 'auth-db1326.hstgr.io',
  user: 'u287432907_admin',
  password: 'Hitam@2025',
  database: 'u287432907_TEDx2025',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  console.log("✅ MySQL Connected");
});

// 📤 FTP Upload Function
async function uploadToFTP(buffer, remoteFilename) {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: "46.28.45.150",
      port: 21,
      user: "u287432907",
      password: "Hitam@2025", // 🔒 Replace later with .env
      secure: false,
    });

    const remoteDir = ".";
    await client.ensureDir(remoteDir);

    const stream = Readable.from(buffer); // ✅ Convert Buffer to stream
    await client.uploadFrom(stream, `${remoteFilename}`);

    return `${remoteFilename}`;
  } catch (err) {
    console.error("❌ FTP Upload Error:", err.message);
    throw err;
  } finally {
    client.close();
  }
}

// 📥 Booking API
app.post("/api/booking", upload.single("idCard"), async (req, res) => {
  try {
    const {
      name,
      rollNo,
      branch,
      year,
      email,
      mobile,
      txnId,
      userType,
      seatNo,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "ID Card file missing" });
    }

    const remoteFilename = `${rollNo.toUpperCase()}.jpg`; // 🔤 Filename is Roll No

    // 📤 Upload to FTP
    const ftpPath = await uploadToFTP(req.file.buffer, remoteFilename);

    // 💾 Insert into MySQL
    const sql = `INSERT INTO bookings 
      (name, roll_no, branch, year, email, mobile, txn_id, user_type, seat_no, id_card_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      name, rollNo, branch, year, email, mobile, txnId, userType, seatNo, ftpPath,
    ];

    db.query(sql, values, (err, result) => {
  if (err) {
    console.error("❌ DB Insert Error:", err);
    return res.status(500).json({ error: "Database insert error" });
  }
  res.json({ message: "✅ Booking successful" });
});

  } catch (error) {
    console.error("💥 Global Error:", error);
    res.status(500).json({ error: "❌ Server error during booking" });
  }
});

// ✅ Root route
app.get("/", (req, res) => {
  res.send("🚀 TEDx API is live");
});

// ❌ 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "❌ Route not found" });
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
