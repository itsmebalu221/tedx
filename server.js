const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const ftp = require("basic-ftp");
const cors = require("cors");
const { Readable } = require("stream");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// MySQL Pool
const db = mysql.createPool({
  host: 'auth-db1326.hstgr.io',
  user: 'u287432907_admin',
  password: 'Hitam@2025',
  database: 'u287432907_TEDx2025',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Check DB connection
db.query('SELECT 1', (err) => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  console.log("✅ MySQL Pool is ready");
});

// Upload to FTP
async function uploadToFTP(buffer, remoteFilename) {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: "ftp.tedxhitam.com",
      port: 21,
      user: "u287432907.admin",
      password: "Hitam@2025",
      secure: false,
    });

    const remoteDir = "."; // Upload to root
    await client.ensureDir(remoteDir);

    const stream = Readable.from(buffer);
    await client.uploadFrom(stream, `${remoteDir}/${remoteFilename}`);

    return `${remoteDir}/${remoteFilename}`;
  } catch (err) {
    console.error("❌ FTP Upload Error:", err.message);
    throw err;
  } finally {
    client.close();
  }
}

// Booking API
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

    const remoteFilename = `${email}.jpg`;
    const ftpPath = await uploadToFTP(req.file.buffer, remoteFilename);

    let sql, values;

    switch (userType) {
      case 'student':
        sql = `INSERT INTO bookings 
          (name, roll_no, branch, year, email, mobile, txn_id, user_type, seat_no, id_card_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [name, rollNo, branch, year, email, mobile, txnId, userType, seatNo, ftpPath];
        break;

      case 'faculty':
        sql = `INSERT INTO hitam_fac 
          (name, roll_no, email, mobile, txn_id, user_type, seat_no, id_card_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [name, rollNo, email, mobile, txnId, userType, seatNo, ftpPath];
        break;

      case 'alumni':
        sql = `INSERT INTO hitam_alu 
          (name, roll_no, email, mobile, passed_year, txn_id, user_type, seat_no, id_card_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [name, rollNo, email, mobile, passout, txnId, userType, seatNo, ftpPath];
        break;

      case 'outside':
        sql = `INSERT INTO outside_hitam 
          (name, clg_id, clg_name, email, mobile, txn_id, user_type, seat_no, id_card_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [name, rollNo, oclg, email, mobile, txnId, userType, seatNo, ftpPath];
        break;

      default:
        return res.status(400).json({ error: "Invalid user type" });
    }

    db.query(sql, values, (err) => {
      if (err) {
        console.error("❌ DB Insert Error:", err);
        return res.status(500).json({ error: "Database insert error" });
      }

      res.json({ message: "✅ Booking successful!" });
    });

  } catch (error) {
    console.error("💥 Global Error:", error);
    res.status(500).json({ error: "❌ Server error during booking" });
  }
});

// Health Check
app.get("/", (req, res) => {
  res.send("🚀 TEDx API is live");
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "❌ Route not found" });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
