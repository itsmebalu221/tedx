const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors());
app.use(express.json());

// Serve static files from uploads
app.use('/uploads', express.static('uploads'));

// Configure Multer (storage engine)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Save to uploads folder
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  },
});

const upload = multer({ storage });

// ✅ MySQL Connection
const db = mysql.createConnection({
  host:'auth-db1326.hstgr.io',
  user: 'u287432907_admin',
  password: 'Hitam@2025',
  database: 'u287432907_TEDx2025',
});

db.connect(err => {
  if (err) throw err;
  console.log("✅ MySQL Connected");
});

// ✅ POST /api/booking
app.post("/api/booking", upload.single("idCard"), (req, res) => {
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

  const idCardPath = req.file ? req.file.path : null;

  const sql = `INSERT INTO bookings 
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
    idCardPath,
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("❌ DB Insert Error:", err);
      return res.status(500).json({ error: "Database error" });
    }

    res.json({ message: "✅ Booking submitted successfully!" });
  });
});

// 🟢 Server Start
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
