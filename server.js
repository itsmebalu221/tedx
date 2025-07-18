const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const ftp = require("basic-ftp");
const cors = require("cors");
const path = require("path");
const { Readable } = require("stream");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 5000;

// 📧 Nodemailer Transporter
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: "info@tedxhitam.com",
    pass: "Hitam@2026",
  },
});

// 🛡️ Middleware
app.use(cors());
app.use(express.json());

// 📦 Multer: Store uploaded file in memory
const storage = multer.memoryStorage();
const upload = multer({ storage });

// 🐬 MySQL Pool
const db = mysql.createPool({
  host: 'auth-db1326.hstgr.io',
  user: 'u287432907_admin',
  password: 'Hitam@2025',
  database: 'u287432907_TEDx2025',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ✅ Test DB Connection
db.query('SELECT 1', (err) => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  console.log("✅ MySQL Pool is ready");
});

// 📤 Upload to Hostinger FTP
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

    const remoteDir = ".";
    await client.ensureDir(remoteDir);

    const stream = Readable.from(buffer);
    await client.uploadFrom(stream, remoteFilename);

    return remoteFilename;
  } catch (err) {
    console.error("❌ FTP Upload Error:", err.message);
    throw err;
  } finally {
    client.close();
  }
}

// 📥 Booking Endpoint
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

    // ✅ Generate QR Code (with encoded data)
    const qrData = JSON.stringify({ name, email, seatNo, txnId });
    const qrBase64 = await QRCode.toDataURL(qrData);

    // ✅ Save to DB
    const insertCallback = async (err, result) => {
      if (err) {
        console.error("❌ DB Insert Error:", err);
        return res.status(500).json({ error: "Database insert error" });
      }

      // ✅ Send Email
      await transporter.sendMail({
        from: '"TEDxHITAM" <info@tedxhitam.com>',
        to: email,
        subject: "🎟 Your TEDxHITAM 2025 Ticket is Here!",
        html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background-color: #000; color: #fff; border-radius: 10px; overflow: hidden; border: 2px solid #c71f37;">
  <div style="padding: 20px; background-color: #c71f37; text-align: center;">
    <h1 style="margin: 0; font-size: 32px;">🎟 TEDxHITAM 2025</h1>
    <p style="margin: 5px 0 0;">Access the Invisible</p>
  </div>
  <div style="padding: 30px; background-color: #111;">
    <h2 style="margin: 0 0 10px;">Hi ${name},</h2>
    <p>Your booking for <strong>TEDxHITAM</strong> has been confirmed! Below are your ticket details:</p>
    <table style="margin-top: 20px; width: 100%; font-size: 16px;">
      <tr><td><strong>👤 Name:</strong></td><td>${name}</td></tr>
      <tr><td><strong>📮 Email:</strong></td><td>${email}</td></tr>
      <tr><td><strong>🎫 Seat No:</strong></td><td>${seatNo}</td></tr>
      <tr><td><strong>💳 Txn ID:</strong></td><td>${txnId}</td></tr>
    </table>
    <div style="text-align: center; margin: 30px 0;">
      <img src="cid:qrCode" alt="QR Code" style="width: 200px; height: 200px; border: 4px solid #c71f37; padding: 5px; background: #fff;" />
      <p style="margin-top: 10px; font-size: 14px;">📱 Show this QR code at the entrance</p>
    </div>
    <p>📍 <strong>Date:</strong> July 27, 2025<br/>
       🕒 <strong>Time:</strong> 3:00 PM onwards<br/>
       📍 <strong>Venue:</strong> HITAM Auditorium</p>
    <p style="text-align: center; color: #aaa;">Let’s rewrite the rules of reality. 🚀</p>
    <p style="text-align: center; font-style: italic;">– Team TEDxHITAM</p>
  </div>
</div>
        `,
        attachments: [
          {
            filename: 'qr.png',
            cid: 'qrCode',
            path: qrBase64,
          }
        ]
      });

      return res.json({ message: "✅ Booking successful & Email sent!" });
    };

    // 👤 Handle Insertion Based on userType
    switch (userType) {
      case 'student': {
        const sql = `INSERT INTO bookings 
          (name, roll_no, branch, year, email, mobile, txn_id, user_type, seat_no, id_card_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [name, rollNo, branch, year, email, mobile, txnId, userType, seatNo, ftpPath];
        db.query(sql, values, insertCallback);
        break;
      }

      case 'faculty': {
        const sql = `INSERT INTO hitam_fac 
          (name, hitam_id, email, phone, txn_id, user_type, seat_no, file_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [name, rollNo, email, mobile, txnId, userType, seatNo, ftpPath];
        db.query(sql, values, insertCallback);
        break;
      }

      case 'alumni': {
        const sql = `INSERT INTO hitam_alu 
          (name, roll_no, email, phone, passed_year, txn_id, user_type, seat_no, file_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [name, rollNo, email, mobile, passout, txnId, userType, seatNo, ftpPath];
        db.query(sql, values, insertCallback);
        break;
      }

      case 'outside': {
        const sql = `INSERT INTO outside_hitam 
          (name, clg_id, clg_name, email, phone, txn_id, user_type, seat_no, file_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [name, rollNo, oclg, email, mobile, txnId, userType, seatNo, ftpPath];
        db.query(sql, values, insertCallback);
        break;
      }

      default:
        return res.status(400).json({ error: "Invalid userType" });
    }
  } catch (error) {
    console.error("💥 Global Error:", error);
    res.status(500).json({ error: "❌ Server error during booking" });
  }
});

// ✅ Root Route
app.get("/", (req, res) => {
  res.send("🚀 TEDx API is live");
});

// ❌ 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "❌ Route not found" });
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});