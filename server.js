const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const cors = require("cors");
const path = require("path");
require("dotenv").config();


const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// 🔐 Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Folder must exist
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  },
});

const upload = multer({ storage });

// 🔌 MySQL connection
const db = mysql.createConnection({
  host: 'auth-db1326.hstgr.io',
  user: 'u287432907_admin',
  password: 'Hitam@2025',
  database: 'u287432907_TEDx2025',
});

db.connect(err => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1); // Stop server if DB fails
  }
  console.log("✅ MySQL Connected");
});

// 🚀 Booking API
app.post("/api/booking", upload.single("idCard"), (req, res) => {
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
  } catch (error) {
    console.error("❌ Server error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/',(req,res)=>{
  res.send("hii");
})

// 🔍 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "❌ Route not found",
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});



// 💥 Global error handler
app.use((err, req, res, next) => {
  console.error("💥 Global Error:", err.stack);
  res.status(500).json({
    error: "❌ Server Error",
    message: err.message || "Something went wrong",
  });
});

// 🌐 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
