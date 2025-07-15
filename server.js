const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const ftp = require("basic-ftp");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// === 🗂 Multer setup (temp upload folder) ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // temp local dir (must exist!)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const rollNo = req.body.rollNo || "unknown";
    cb(null, `${rollNo}${ext}`);
  },
});
const upload = multer({ storage });

// === 💾 MySQL connection ===
const db = mysql.createConnection({
  host: "auth-db1326.hstgr.io",
  user: "u287432907_admin",
  password: "Hitam@2025",
  database: "u287432907_TEDx2025",
});
db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  console.log("✅ MySQL connected");
});

// === 📤 FTP Upload to Hostinger ===
async function uploadToHostinger(localPath, remoteFilename) {
  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    await client.access({
      host: "ftp://46.28.45.150",
      user: "u287432907",
      password: "Hitam@2025",
      secure: false
    });

    const remotePath = `/public_html/uploads/${remoteFilename}`;
    await client.uploadFrom(localPath, remotePath);
    console.log("✅ File uploaded to Hostinger:", remotePath);
    return remotePath;
  } catch (err) {
    console.error("❌ FTP upload failed:", err.message);
    throw err;
  } finally {
    client.close();
  }
}

// === 🚀 Booking endpoint ===
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
      seatNo
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "ID Card is required." });
    }

    const localPath = req.file.path;
    const remoteFilename = req.file.filename;

    const remotePath = await uploadToHostinger(localPath, remoteFilename);

    // Optional: delete local temp file
    fs.unlink(localPath, (err) => {
      if (err) console.error("⚠️ Could not delete local file:", err);
    });

    // Insert into MySQL
    const sql = `
      INSERT INTO bookings
      (name, roll_no, branch, year, email, mobile, txn_id, user_type, seat_no, id_card_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
      name,
      rollNo,
      branch,
      year,
      email,
      mobile,
      txnId,
      userType,
      seatNo,
      remotePath
    ];

    db.query(sql, values, (err, result) => {
      if (err) {
        console.error("❌ MySQL insert error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({ message: "✅ Booking successful!" });
    });

  } catch (err) {
    console.error("❌ Booking error:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// Default route
app.get("/", (req, res) => {
  res.send("🎉 TEDx Booking API is running.");
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("💥 Global Error:", err.stack);
  res.status(500).json({
    error: "❌ Server Error",
    message: err.message || "Something went wrong",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
