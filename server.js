const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const ftp = require("basic-ftp");
const cors = require("cors");
const path = require("path");
const { Readable } = require("stream");

const app = express();
const PORT = process.env.PORT || 5000;

// 🛡️ Middleware
app.use(cors());
app.use(express.json());

// 📦 Multer memory storage for in-memory file upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 🐬 MySQL Pool Configuration
const db = mysql.createPool({
  host: 'auth-db1326.hstgr.io',
  user: 'u287432907_admin',
  password: 'Hitam@2025',
  database: 'u287432907_TEDx2025',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ✅ Optional DB ping to check connection at startup
db.query('SELECT 1', (err) => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  console.log("✅ MySQL Pool is ready");
});

// 📤 Upload image to Hostinger FTP server
async function uploadToFTP(buffer, remoteFilename) {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: "ftp.tedxhitam.com",      // Without ftp://
      port: 21,
      user: "u287432907.admin",
      password: "Hitam@2025",
      secure: false,
    });

    const remoteDir = "."; // Make sure this directory exists
    await client.ensureDir(remoteDir);

    const stream = Readable.from(buffer); // Convert Buffer to readable stream
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
      oclg,
      passout,

    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "ID Card file missing" });
    }

    const remoteFilename = `${email}.jpg`
    const ftpPath = await uploadToFTP(req.file.buffer, remoteFilename);

    const cb = (err, result) => {
  if (err) {
    console.error("❌ DB Insert Error:", err);
    return res.status(500).json({ error: "Database insert error" });
  }
  res.json({ message: "✅ Booking successful!" });
};


    switch (userType) {
  case 'student':
    const sql = `INSERT INTO bookings 
      (name, roll_no, branch, year, email, mobile, txn_id, user_type, seat_no, id_card_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [name, rollNo, branch, year, email, mobile, txnId, userType, seatNo, ftpPath];
    db.query(sql, values, cb); // cb = callback handler
    break;

  case 'faculty':
    const sql1 = `INSERT INTO hitam_fac 
      (name, hitam_id, email, phone, txn_id, user_type, seat_no, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const values1 = [name, rollNo, email, mobile, txnId, userType, seatNo, ftpPath];
    db.query(sql1, values1, cb);
    break;

  case 'alumni':
    const sql2 = `INSERT INTO hitam_alu 
      (name, roll_no, email, phone, passed_year, txn_id, user_type, seat_no, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values2 = [name, rollNo, email, mobile, passout, txnId, userType, seatNo, ftpPath];
    db.query(sql2, values2, cb);
    break;

  case 'outside':
    const sql3 = `INSERT INTO outside_hitam 
      (name, clg_id, clg_name, email, phone, txn_id, user_type, seat_no, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values3 = [name, rollNo, oclg, email, mobile, txnId, userType, seatNo, ftpPath];
    db.query(sql3, values3, cb);
    break;
}




  } catch (error) {
    console.error("💥 Global Error:", error);
    res.status(500).json({ error: "❌ Server error during booking" });
  }
});

// ✅ Root route
app.get("/", (req, res) => {
  res.send("🚀 TEDx API is live");
});

// ❌ 404 route
app.use((req, res) => {
  res.status(404).json({ error: "❌ Route not found" });
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
