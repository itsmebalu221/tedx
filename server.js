// server.js
const express = require("express");
const multer = require("multer");
const mysql = require("mysql2");
const ftp = require("basic-ftp");
const cors = require("cors");
const path = require("path");
const { Readable } = require("stream");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;

/* ----------------------------- SMTP (Hostinger) ---------------------------- */
/* NOTE:
   - Port 587 + STARTTLS is generally required on Azure App Service.
   - If your hPanel forces SSL on 465, change `port: 465, secure: true` and
     remove `requireTLS`.
*/
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 587,
  secure: false,           // STARTTLS
  requireTLS: true,
  auth: {
    user: "invisible@tedxhitam.com",
    pass: "Hitam@2026",
  },
  tls: {
    // If you see CERT errors behind corporate proxies, you can toggle the next line:
    // rejectUnauthorized: false,
  },
});

/* -------------------------------- Middleware ------------------------------- */
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* ------------------------------- Multer Setup ------------------------------ */
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB per file
    files: 4,
  },
});

/* ------------------------------- MySQL (Pool) ------------------------------ */
const db = mysql.createPool({
  host: "auth-db1326.hstgr.io",
  user: "u287432907_admin",
  password: "Hitam@2025",
  database: "u287432907_TEDx2025",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.query("SELECT 1", (err) => {
  if (err) {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  }
  console.log("✅ MySQL Pool is ready");
});

/* ------------------------------- FTP Helpers ------------------------------- */
async function uploadToFTP(buffer, remoteFilename, { host, user, password }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("Upload buffer missing or invalid.");
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;
  // Force passive IPv4 (more compatible on Azure)
  client.prepareTransfer = ftp.enterPassiveModeIPv4;

  try {
    await client.access({
      host,
      port: 21,
      user,
      password,
      secure: false, // switch to true + proper certs if your FTP supports FTPS
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

async function uploadToFTP_ID(buffer, remoteFilename) {
  return uploadToFTP(buffer, remoteFilename, {
    host: "ftp.tedxhitam.com",
    user: "u287432907.adminID",
    password: "Hitam@2026",
  });
}

async function uploadToFTP_PAY(buffer, remoteFilename) {
  return uploadToFTP(buffer, remoteFilename, {
    host: "ftp.tedxhitam.com",
    user: "u287432907.adminPAY",
    password: "Hitam@2026",
  });
}

/* ---------------------------- Email Attach Utils --------------------------- */
// Convert a data: URL to a Nodemailer attachment payload
function dataUrlToAttachment(dataUrl, { filename, cid }) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error("Invalid data URL for attachment.");
  }
  const base64 = dataUrl.split("base64,")[1];
  if (!base64) {
    throw new Error("Failed to parse base64 data from data URL.");
  }
  return {
    filename,
    cid, // To embed in HTML via <img src="cid:...">
    content: base64,
    encoding: "base64",
  };
}

/* --------------------------------- Routes --------------------------------- */

// 📥 Booking Endpoint (with ID + Payment uploads depending on userType)
app.post(
  "/api/booking",
  upload.fields([
    { name: "idCard", maxCount: 1 },
    { name: "paymentScreenshot", maxCount: 1 },
  ]),
  async (req, res) => {
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
        passout,
        Designation,
        EmpCom,
      } = req.body;

      // Basic input checks (kept light; preserve your original API shape)
      if (!name || !email || !mobile || !txnId || !userType || !seatNo) {
        return res
          .status(400)
          .json({ error: "Missing required fields (name, email, mobile, txnId, userType, seatNo)." });
      }

      // Upload requirements per userType
      const needsIdCard = ["student", "faculty", "outside"].includes(userType);
      const needsPayment = true; // all variants insert payment path

      // Extract files
      const idCardBuffer = req.files?.["idCard"]?.[0]?.buffer;
      const paymentBuffer = req.files?.["paymentScreenshot"]?.[0]?.buffer;

      if (needsIdCard && !idCardBuffer) {
        return res.status(400).json({ error: "ID Card file is required for this userType." });
      }
      if (needsPayment && !paymentBuffer) {
        return res.status(400).json({ error: "Payment screenshot file is required." });
      }

      // Upload to FTPs as required
      let ftpPath = null;
      if (needsIdCard) {
        const idCardFilename = `${email}_id.jpg`;
        ftpPath = await uploadToFTP_ID(idCardBuffer, idCardFilename);
      }

      const paymentFilename = `${email}_payment.jpg`;
      const paymentPath = await uploadToFTP_PAY(paymentBuffer, paymentFilename);

      // ✅ Generate QR Code (with encoded data)
      const qrData = JSON.stringify({ name, email, seatNo, txnId });
      const qrBase64 = await QRCode.toDataURL(qrData);

      // Build email attachments
      const attachments = [
        dataUrlToAttachment(qrBase64, { filename: "qr.png", cid: "qrCode" }),
      ];

      // Add logo if present on disk
      const logoPath = path.join(__dirname, "/logo.png");
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: "logo.png",
          cid: "invisibleLogo",
          path: logoPath,
        });
      } else {
        console.warn("⚠️ logo.png not found next to server file; email will be sent without embedded logo.");
      }

      // Common email HTML (unchanged content)
      const emailHtml = `<!-- Import Fonts -->
<link href="https://fonts.googleapis.com/css?family=Montserrat:700,400&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css?family=Roboto+Slab:400,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">

<div style="font-family: 'Montserrat', Arial, sans-serif; max-width: 600px; margin: auto; background: linear-gradient(135deg, #181823 60%, #c71f37 100%); color: #fff; border-radius: 22px; overflow: hidden; border: 2.5px solid #c71f37; box-shadow: 0 8px 36px rgba(38,0,39,0.15);">

<!-- Logo Section -->
<div style="background: rgba(24,24,35,0.98);  text-align: center;">
  <img src="cid:invisibleLogo" alt="Invisible TEDx Logo" style="width:400px; " />
</div>

<!-- Body Content -->
<div style="padding: 36px 32px 34px 32px; background: rgba(24,24,35,0.98);">
  <h2 style="margin: 0 0 14px; font-family: 'Roboto Slab', serif; font-weight:700; color: #ffdf4f; font-size: 23px;">
    Hey ${name.split(" ")[0]}!
  </h2>
  <p style="font-size: 17px; color: #fff;">
    Thank you for registering for the <b>3rd edition of TEDxHITAM</b>! Your booking is <b>confirmed</b>.
  </p>

  <!-- Theme Section -->
  <section style="margin: 26px 0 22px;">
    <h3 style="color: #c71f37; margin: 0 0 8px; font-family: 'Montserrat', Arial, sans-serif; font-weight:700; font-size:19px;">
      About the Theme: INVISIBLE
    </h3>
    <p style="font-family:'Roboto Slab', serif; font-size:16px; line-height:1.8; color:#f4f4f4;">
      This year, as HITAM celebrates
      <span style="color:#ffdf4f;">25 years of academic excellence & transformative impact</span>,
      TEDxHITAM 2025’s theme <b>‘Invisible’</b> shines a light on untold stories, silent efforts, and the hidden forces shaping remarkable outcomes.<br>
      Let’s honor unseen thoughts, sacrifices, and endurance—the journey that truly builds success. It’s a tribute to people, choices, and challenges that make greatness possible behind the scenes.
    </p>
  </section>

  <!-- Speaker Announcement -->
  <div style="background:rgba(255,223,79,0.16); padding:12px 20px; border-radius:11px; text-align:center; margin:18px 0 10px 0;">
    <span style="color:#ffdf4f; font-weight:700;">Speakers will be updated on <a href="https://tedxhitam.com" target="_blank" style="color:#fff; text-decoration:none;">tedxhitam.com</a> Stay tuned!</span>
  </div>

  <!-- Ticket Details Block -->
  <div style="margin-top: 28px; text-align: left;">
    <span style="display:inline-block; background:#c71f37; color:#fff; border-radius:9px 9px 0 0; padding:7px 20px; letter-spacing: 0.5px; font-family:'Montserrat', Arial, sans-serif; font-weight: 700; font-size: 16px;">
      Your Ticket Details
    </span>
    <table style="margin: 0; width: 100%; font-size: 16px; background:#232342; color:#ebebeb; border-radius: 0 13px 13px 13px; overflow:hidden;">
      <tr><td style="padding:12px 15px;"><strong>Name:</strong></td><td style="padding:12px 15px;">${name}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Email:</strong></td><td style="padding:12px 15px;">${email}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Mobile Number:</strong></td><td style="padding:12px 15px;">${mobile}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Seat Number:</strong></td><td style="padding:12px 15px;">${seatNo}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Transaction ID:</strong></td><td style="padding:12px 15px;">${txnId}</td></tr>
    </table>
  </div>

  <!-- QR Code Block -->
  <div style="text-align: center; margin: 32px 0 24px 0;">
    <img src="cid:qrCode" alt="QR Code" style="width:200px; height:200px; border:4px solid #c71f37; border-radius: 18px; padding:5px; background:#fff; box-shadow:0 4px 16px rgba(199,31,55,0.13);" />
    <p style="margin-top: 14px; font-size: 15px; font-family:'Montserrat', Arial, sans-serif; color:#ffdf4f;">
      <b>Show this QR code at the registration desk</b>
    </p>
    <p style="margin-top: 8px; font-size: 14px; font-family:'Montserrat', Arial, sans-serif; color: rgba(199,31,55,0.7); font-style: italic; font-weight: 600;">
      Please keep your QR code private—sharing it with others may compromise your entry.
    </p>
    <a 
  href="https://chat.whatsapp.com/IwyizdjHjfIFdSdgVHax0j"
  target="_blank"
  style="display:inline-block; padding:12px 30px; border-radius:25px; background:linear-gradient(90deg,#c71f37,#181823); color:#fff; font-weight:700; text-decoration:none; font-family:'Montserrat',Arial,sans-serif; margin:12px auto; box-shadow:0 2px 8px rgba(199,31,55,0.2);"
>
  Join WhatsApp Group
</a>
    <a 
  href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=TEDxHITAM+2025+-+Invisible&dates=20250920T043000Z/20250920T103000Z&details=Join+us+for+TEDxHITAM's+3rd+edition+under+the+theme+'Invisible'.+Venue:+HITAM+Auditorium&location=HITAM+Auditorium&sf=true&output=xml"
  target="_blank"
  style="display:inline-block; padding:12px 30px; border-radius:25px; background:linear-gradient(90deg,#c71f37,#181823); color:#fff; font-weight:700; text-decoration:none; font-family:'Montserrat',Arial,sans-serif; margin:12px auto; box-shadow:0 2px 8px rgba(199,31,55,0.2);"
>
  Add to Calendar
</a>
  </div>

  <!-- Event Info Card -->
  <div style="font-family:'Montserrat', Arial, sans-serif; text-align: left;">
    <span style="display:inline-block; background:#c71f37; color:#fff; border-radius:9px 9px 0 0; padding:8px 20px; letter-spacing: 0.5px; font-weight: 700; font-size: 16px;">
      Event Details
    </span>
    <div style="background:#232342; color:#fff; border-radius:0 13px 13px 13px; padding:20px 25px; margin-bottom:18px; box-shadow: 0 5px 15px rgba(0,0,0,0.25);">
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-calendar-days" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Date:</b> <span style="color:#ffdf4f;">20th September 2025</span></span>
      </div>
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-clock" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Time:</b> 10:00 AM onwards</span>
      </div>
      <div style="display:flex; align-items:center; font-size:16px;">
        <i class="fas fa-map-marker-alt" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Venue:</b> <span style="color:#c71f37; font-weight:bold;">HITAM Auditorium</span></span>
      </div>
    </div>
  </div>

  <!-- Social Links -->
<p style="text-align:center; color:#aaa; font-size:15px; margin-top:18px;">
  Follow us for instant updates:<br>
  <b>
    <a href="https://www.instagram.com/tedxhitam/" target="_blank" style="color:#c71f37; text-decoration:none;">
      <i class="fab fa-instagram"></i> Instagram
    </a>
  </b>
</p>

  <!-- Vibrant Closing Section -->
  <p style="text-align: center; font-size:18px; color:#ffdf4f; margin-top:24px; letter-spacing:0.6px;">
    See you on <b>20th September!</b>
  </p>
  <p style="text-align: center; color: #aaa; font-size:16px; margin-bottom: 7px; font-family: 'Montserrat', Arial, sans-serif; letter-spacing: 0.7px;">
    Not everything that shapes us is seen. Sometimes, the most powerful stories are <b>INVISIBLE</b>.
  </p>
  <p style="text-align: center; font-style: italic; color:#fff; font-family:'Roboto Slab', serif; font-size: 16px;">
    – Team TEDxHITAM
  </p>

</div> <!-- End of Body Content -->
</div> <!-- End of Main Wrapper -->`;

      // Insert callback shared by multiple userTypes
      const insertCallback = async (err) => {
        if (err) {
          console.error("❌ DB Insert Error:", err);
          return res.status(500).json({ error: "Database insert error" });
        }

        try {
          await transporter.sendMail({
            from: '"TEDxHITAM" <info@tedxhitam.com>',
            to: email,
            subject: "🎟 Your TEDxHITAM 2025 Ticket is Here!",
            html: emailHtml,
            attachments,
          });
        } catch (mailErr) {
          console.error("❌ Email Send Error:", mailErr);
          // Still return success for booking, but surface mail error
          return res.status(200).json({
            message:
              "✅ Booking saved, but email failed to send. We’ll re-attempt shortly.",
          });
        }

        return res.json({ message: "✅ Booking successful & Email sent!" });
      };

      // 👤 Handle Insertion Based on userType
      switch (userType) {
        case "student": {
          const sql = `INSERT INTO bookings 
            (name, roll_no, branch, year, email, mobile, txn_id, user_type, seat_no, id_card_path, payment_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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
            ftpPath,
            paymentPath,
          ];
          db.query(sql, values, insertCallback);
          break;
        }

        case "faculty": {
          const sql = `INSERT INTO hitam_fac 
            (name, dept, email, phone, txn_id, user_type, seat_no, file_path, payment_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          const values = [
            name,
            rollNo,
            email,
            mobile,
            txnId,
            userType,
            seatNo,
            ftpPath,
            paymentPath,
          ];
          db.query(sql, values, insertCallback);
          break;
        }

        case "alumni": {
          const sql = `INSERT INTO hitam_alu 
            (name, email, phone, passed_year, txn_id, user_type, seat_no, des, empcom, payment_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          const values = [
            name,
            email,
            mobile,
            passout,
            txnId,
            userType,
            seatNo,
            Designation,
            EmpCom,
            paymentPath,
          ];
          db.query(sql, values, insertCallback);
          break;
        }

        case "outside": {
          const sql = `INSERT INTO outside_hitam 
            (name, dept, email, phone, txn_id, user_type, seat_no, file_path, payment_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
          const values = [
            name,
            rollNo,
            email,
            mobile,
            txnId,
            userType,
            seatNo,
            ftpPath,
            paymentPath,
          ];
          db.query(sql, values, insertCallback);
          break;
        }

        default:
          return res.status(400).json({ error: "Invalid userType" });
      }
    } catch (error) {
      console.error("💥 Global Error (/api/booking):", error);
      res.status(500).json({ error: "❌ Server error during booking" });
    }
  }
);

// Deactivate (set status = 0) for a given email across all booking tables
// 📌 Simple Deactivate Route
app.get("/api/deactivate", async (req, res) => {
  const email = (req.body?.email || req.query?.email || "").trim();
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const tables = [
    "bookings",
    "bookingsExternal",
    "hitam_alu",
    "hitam_fac",
    "outside_hitam",
  ];

  const results = [];

  for (const table of tables) {
    try {
      const [result] = await db
        .promise()
        .query(`UPDATE \`${table}\` SET status = 1 WHERE email = ?`, [email]);

      results.push({
        table,
        affectedRows: result.affectedRows,
      });
    } catch (err) {
      // Skip if table doesn’t have "status" column
      results.push({
        table,
        affectedRows: 0,
        error: err.message,
      });
    }
  }

  res.json({
    email,
    results,
    message: "Deactivate process completed",
  });
});



// 📥 External Booking (payment screenshot only)
app.post(
  "/api/bookingExternal",
  upload.single("paymentScreenshot"),
  async (req, res) => {
    try {
      const { name, email, mobile, txnId, userType, seatNo, Designation, Organization } = req.body;

      if (!name || !email || !mobile || !txnId || !userType || !seatNo) {
        return res
          .status(400)
          .json({ error: "Missing required fields (name, email, mobile, txnId, userType, seatNo)." });
      }
      if (!req.file?.buffer) {
        return res.status(400).json({ error: "Payment screenshot file is required." });
      }

      // QR for email
      const qrData = JSON.stringify({ name, email, seatNo, txnId });
      const qrBase64 = await QRCode.toDataURL(qrData);

      const remoteFilename = `${email}.jpg`;
      const ftpPath = await uploadToFTP_PAY(req.file.buffer, remoteFilename);

      // ✅ Insert into MySQL
      const sql = `INSERT INTO bookingsExternal 
        (name, email, mobile, txn_id, user_type, seat_no, Organization, Designation, paymentPath)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        name,
        email,
        mobile,
        txnId,
        userType,
        seatNo,
        Organization,
        Designation,
        ftpPath,
      ];

      db.query(sql, values, async (err) => {
        if (err) {
          console.error("❌ DB Insert Error:", err);
          return res.status(500).json({ error: "Database insert error" });
        }

        try {
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
              dataUrlToAttachment(qrBase64, { filename: "qr.png", cid: "qrCode" }),
            ],
          });
        } catch (mailErr) {
          console.error("❌ Email Send Error:", mailErr);
          return res.status(200).json({
            message:
              "✅ Booking saved, but email failed to send. We’ll re-attempt shortly.",
          });
        }

        res.json({ message: "✅ Booking successful & Email sent!" });
      });
    } catch (error) {
      console.error("💥 Global Error (/api/bookingExternal):", error);
      res.status(500).json({ error: "❌ Server error during booking" });
    }
  }
);

//Fetch Details
app.get("/api/fetchDetails", (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: "Email query parameter is required" });
  }

  const tables = ["bookings", "bookingsExternal", "hitam_alu", "hitam_fac", "outside_hitam"];

  // Recursive search function
  function searchTable(index) {
    if (index >= tables.length) {
      return res.status(404).json({ error: "No booking found for this email" });
    }

    const table = tables[index];
    const sql = `SELECT *, '${table}' AS source FROM ${table} WHERE email = ? LIMIT 1`;

    db.query(sql, [email], (err, results) => {
      if (err) {
        console.error(`❌ Error searching ${table}:`, err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length > 0) {
        // ✅ Found match → return immediately
        return res.json({ booking: results[0] });
      } else {
        // ⏭️ Not found in this table → check next
        searchTable(index + 1);
      }
    });
  }

  // Start searching from first table
  searchTable(0);
});

// Route to trigger bulk mail
app.get("/send-mails", async (req, res) => {
  try {
    // Fetch recipients
    const rows = await new Promise((resolve, reject) => {
      db.query("SELECT email, name, mobile, txn_id, seat_no FROM bookings", (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    let sentCount = 0;

    for (const row of rows) {
      // ✅ Generate QR per user
      const qrData = JSON.stringify({
        name: row.name,
        email: row.email,
        seatNo: row.seat_no,
        txnId: row.txn_id,
      });
      const qrBase64 = await QRCode.toDataURL(qrData);

      const mailOptions = {
        from: '"TEDxHITAM" <invisible@tedxhitam.com>',
        to: row.email,
        subject: "🎟 Your TEDxHITAM 2025 Ticket is Here!",
        html: `<!-- Import Fonts -->
<link href="https://fonts.googleapis.com/css?family=Montserrat:700,400&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css?family=Roboto+Slab:400,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">

<div style="font-family: 'Montserrat', Arial, sans-serif; max-width: 600px; margin: auto; background: linear-gradient(135deg, #181823 60%, #c71f37 100%); color: #fff; border-radius: 22px; overflow: hidden; border: 2.5px solid #c71f37; box-shadow: 0 8px 36px rgba(38,0,39,0.15);">

<!-- Logo Section -->
<div style="background: rgba(24,24,35,0.98);  text-align: center;">
  <img src="cid:invisibleLogo" alt="Invisible TEDx Logo" style="width:400px; " />
</div>

<!-- Body Content -->
<div style="padding: 36px 32px 34px 32px; background: rgba(24,24,35,0.98);">
  <h2 style="margin: 0 0 14px; font-family: 'Roboto Slab', serif; font-weight:700; color: #ffdf4f; font-size: 23px;">
    Hey ${row.name.split(" ")[0]}!
  </h2>
  <p style="font-size: 17px; color: #fff;">
    Thank you for registering for the <b>3rd edition of TEDxHITAM</b>! Your booking is <b>confirmed</b>.
  </p>

  <!-- Theme Section -->
  <section style="margin: 26px 0 22px;">
    <h3 style="color: #c71f37; margin: 0 0 8px; font-family: 'Montserrat', Arial, sans-serif; font-weight:700; font-size:19px;">
      About the Theme: INVISIBLE
    </h3>
    <p style="font-family:'Roboto Slab', serif; font-size:16px; line-height:1.8; color:#f4f4f4;">
      This year, as HITAM celebrates
      <span style="color:#ffdf4f;">25 years of academic excellence & transformative impact</span>,
      TEDxHITAM 2025’s theme <b>‘Invisible’</b> shines a light on untold stories, silent efforts, and the hidden forces shaping remarkable outcomes.<br>
      Let’s honor unseen thoughts, sacrifices, and endurance—the journey that truly builds success. It’s a tribute to people, choices, and challenges that make greatness possible behind the scenes.
    </p>
  </section>

  <!-- Speaker Announcement -->
  <div style="background:rgba(255,223,79,0.16); padding:12px 20px; border-radius:11px; text-align:center; margin:18px 0 10px 0;">
    <span style="color:#ffdf4f; font-weight:700;">Meet Our Speakers at  <a href="https://tedxhitam.com/speakers" target="_blank" style="color:#fff; text-decoration:none;">tedxhitam.com/speakers</a> </span>
  </div>
  <div style="background:rgba(255,223,79,0.16); padding:12px 20px; border-radius:11px; text-align:center; margin:18px 0 10px 0;">
    <span style="color:#ffdf4f; font-weight:700;">Dress Code :<a href="#" target="_blank" style="color:#fff; text-decoration:none;">Business Casuals</a></span>
  </div>

  <!-- Ticket Details Block -->
  <div style="margin-top: 28px; text-align: left;">
    <span style="display:inline-block; background:#c71f37; color:#fff; border-radius:9px 9px 0 0; padding:7px 20px; letter-spacing: 0.5px; font-family:'Montserrat', Arial, sans-serif; font-weight: 700; font-size: 16px;">
      Your Ticket Details
    </span>
    <table style="margin: 0; width: 100%; font-size: 16px; background:#232342; color:#ebebeb; border-radius: 0 13px 13px 13px; overflow:hidden;">
      <tr><td style="padding:12px 15px;"><strong>Name:</strong></td><td style="padding:12px 15px;">${row.name}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Email:</strong></td><td style="padding:12px 15px;">${row.email}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Mobile Number:</strong></td><td style="padding:12px 15px;">${row.phone}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Seat Number:</strong></td><td style="padding:12px 15px;">${row.seat_no}</td></tr>
      <tr><td style="padding:12px 15px;"><strong>Transaction ID:</strong></td><td style="padding:12px 15px;">${row.txn_id}</td></tr>
    </table>
  </div>

  <!-- QR Code Block -->
  <div style="text-align: center; margin: 32px 0 24px 0;">
    <img src="cid:qrCode" alt="QR Code" style="width:200px; height:200px; border:4px solid #c71f37; border-radius: 18px; padding:5px; background:#fff; box-shadow:0 4px 16px rgba(199,31,55,0.13);" />
    <p style="margin-top: 14px; font-size: 15px; font-family:'Montserrat', Arial, sans-serif; color:#ffdf4f;">
      <b>Show this QR code at the registration desk</b>
    </p>
    <p style="margin-top: 8px; font-size: 14px; font-family:'Montserrat', Arial, sans-serif; color: rgba(199,31,55,0.7); font-style: italic; font-weight: 600;">
      Please keep your QR code private—sharing it with others may compromise your entry.
    </p>
    <a 
  href="https://chat.whatsapp.com/IwyizdjHjfIFdSdgVHax0j"
  target="_blank"
  style="display:inline-block; padding:12px 30px; border-radius:25px; background:linear-gradient(90deg,#c71f37,#181823); color:#fff; font-weight:700; text-decoration:none; font-family:'Montserrat',Arial,sans-serif; margin:12px auto; box-shadow:0 2px 8px rgba(199,31,55,0.2);"
>
  Join WhatsApp Group
</a>
    <a 
  href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=TEDxHITAM+2025+-+Invisible&dates=20250920T043000Z/20250920T103000Z&details=Join+us+for+TEDxHITAM's+3rd+edition+under+the+theme+'Invisible'.+Venue:+HITAM+Auditorium&location=HITAM+Auditorium&sf=true&output=xml"
  target="_blank"
  style="display:inline-block; padding:12px 30px; border-radius:25px; background:linear-gradient(90deg,#c71f37,#181823); color:#fff; font-weight:700; text-decoration:none; font-family:'Montserrat',Arial,sans-serif; margin:12px auto; box-shadow:0 2px 8px rgba(199,31,55,0.2);"
>
  Add to Calendar
</a>
  </div>
  
  
   <div style="background:rgba(255,223,79,0.16); padding:12px 20px; border-radius:11px;  margin:18px 0 10px 0;">
     <h3><u>Important Instructions</u></h3>
    <span style="color:#ffdf4f; font-weight:700;">Registration Desk :<a href="#" target="_blank" style="color:#fff; text-decoration:none;">Located at G07A.
</a></span><br><br>
     <span style="color:#ffdf4f; font-weight:700;">Speaker Etiquette :<a href="#" target="_blank" style="color:#fff; text-decoration:none;"> We kindly request everyone to avoid cross-talks and unnecessary movement during sessions, as a gesture of respect towards the speakers.


</a></span><br><br>
     <span style="color:#ffdf4f; font-weight:700;">Room Access :<a href="#" target="_blank" style="color:#fff; text-decoration:none;"> The hall doors will remain closed while a speaker is on the stage.
</a></span>

     <span style="color:#ffdf4f; font-weight:700;">1. <a href="#" target="_blank" style="color:#fff; text-decoration:none;">All the students need to carry their college ID cards. 
</a></span><br><br>
     <span style="color:#ffdf4f; font-weight:700;">2. <a href="#" target="_blank" style="color:#fff; text-decoration:none;">Everyone must carry a valid govt ID proof.

</a></span><br><br>

 <span style="color:#ffdf4f; font-weight:700;">2. <a href="#" target="_blank" style="color:#fff; text-decoration:none;">Registration desks will be open from 9am. 
</a></span><br><br>
    
  </div>

  <!-- Event Info Card -->
  <div style="font-family:'Montserrat', Arial, sans-serif; text-align: left;">
    <span style="display:inline-block; background:#c71f37; color:#fff; border-radius:9px 9px 0 0; padding:8px 20px; letter-spacing: 0.5px; font-weight: 700; font-size: 16px;">
      Event Details
    </span>
    <div style="background:#232342; color:#fff; border-radius:0 13px 13px 13px; padding:20px 25px; margin-bottom:18px; box-shadow: 0 5px 15px rgba(0,0,0,0.25);">
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-calendar-days" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Date:</b> <span style="color:#ffdf4f;">20th September 2025</span></span>
      </div>
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-clock" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Time:</b> 10:00 AM onwards</span>
      </div>
      <div style="display:flex; align-items:center; font-size:16px;">
        <i class="fas fa-map-marker-alt" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Venue:</b> <span style="color:#c71f37; font-weight:bold;">HITAM Auditorium</span></span>
      </div>
    </div>
  </div>

  <!-- Social Links -->
<p style="text-align:center; color:#aaa; font-size:15px; margin-top:18px;">
  Follow us for instant updates:<br>
  <b>
    <a href="https://www.instagram.com/tedxhitam/" target="_blank" style="color:#c71f37; text-decoration:none;">
      <i class="fab fa-instagram"></i> Instagram
    </a>
  </b>
</p>

  <!-- Vibrant Closing Section -->
  <p style="text-align: center; font-size:18px; color:#ffdf4f; margin-top:24px; letter-spacing:0.6px;">
    See you on <b>20th September!</b>
  </p>
  <p style="text-align: center; color: #aaa; font-size:16px; margin-bottom: 7px; font-family: 'Montserrat', Arial, sans-serif; letter-spacing: 0.7px;">
    Not everything that shapes us is seen. Sometimes, the most powerful stories are <b>INVISIBLE</b>.
  </p>
  <p style="text-align: center; font-style: italic; color:#fff; font-family:'Roboto Slab', serif; font-size: 16px;">
    – Team TEDxHITAM
  </p>

</div> <!-- End of Body Content -->
</div> <!-- End of Main Wrapper -->`,
        attachments: [
          {
            filename: "logo.png",
            cid: "invisibleLogo",
            path: path.join(__dirname, "/logo.png"),
          },
          {
            filename: "qrcode.png",
            content: qrBase64.split("base64,")[1],
            encoding: "base64",
            cid: "qrCode", // referenced in HTML
          },
        ],
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`✅${row.id} Sent to ${row.email}`);
        sentCount++;
      } catch (mailErr) {
        console.error(`❌ ${row.id} Failed to send to ${row.email}:`, mailErr);
      }
    }

    res.json({ message: `Bulk mail completed. Sent to ${sentCount}/${rows.length} users.` });
  } catch (err) {
    console.error("💥 Error in /send-mails:", err);
    res.status(500).json({ error: "Bulk mail failed" });
  }
});

app.get("/send-mails-org", async (req, res) => {
  try {
    // 🔹 Static email list
    const rows = [
  { email: "assistant.deanaccreditation@hitam.org" },
  { email: "surendra@hitam.org" },
  { email: "assistantdean.se@hitam.org" },
  { email: "ashalatha.sh@hitam.org" },
  { email: "dean.ce@hitam.org" },
  { email: "dean.freshman@hitam.org" }
];



    let sentCount = 0;

    for (const row of rows) {
      const mailOptions = {
        from:'"TEDxHITAM" <invisible@tedxhitam.com>',
        to: row.email,
        subject: "Invitation – TEDxHITAM 2025 Leadership Faculty",
        html: `<!-- Import Fonts -->
<link href="https://fonts.googleapis.com/css?family=Montserrat:700,400&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css?family=Roboto+Slab:400,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">

<div style="font-family: 'Montserrat', Arial, sans-serif; max-width: 600px; margin: auto; background: linear-gradient(135deg, #181823 60%, #c71f37 100%); color: #fff; border-radius: 22px; overflow: hidden; border: 2.5px solid #c71f37; box-shadow: 0 8px 36px rgba(38,0,39,0.15);">

<!-- Body Content -->
<div style="padding: 36px 32px 34px 32px; background: rgba(24,24,35,0.98);">
  <h2 style="margin: 0 0 14px; font-family: 'Roboto Slab', serif; font-weight:700; color: #ffdf4f; font-size: 23px;">
    Dear Esteemed Faculty Leader!
  </h2>
  <p style="font-size: 17px; color: #fff;">
    As a distinguished member of the <b>HITAM Leadership Faculty</b>, we are honored to extend our heartfelt invitation to the <b>3rd edition</b> of TEDxHITAM 2025. Your presence and guidance are invaluable as we celebrate ideas worth spreading and inspire our academic community.
  </p>

  <!-- Special Recognition -->
  <div style="background:rgba(199,31,55,0.2); padding:16px 20px; border-radius:11px; margin:20px 0; border-left: 4px solid #c71f37;">
    <p style="margin:0; color:#ffdf4f; font-weight:700; font-size:16px;">
     <svg xmlns="http://www.w3.org/2000/svg" 
     width="20" height="20" viewBox="0 0 24 24" 
     fill="#ffdf4f" style="margin-right:8px; vertical-align:middle;">
  <path d="M12 .587l3.668 7.571 8.332 1.151-6.064 5.828 
           1.48 8.276L12 18.896l-7.416 4.517 
           1.48-8.276L0 9.309l8.332-1.151z"/>
</svg>
      Your leadership and mentorship have been the INVISIBLE foundation of our institution's success. We deeply appreciate your continued support!
    </p>
  </div>

  <!-- Theme Section -->
  <section style="margin: 26px 0 22px;">
    <h3 style="color: #c71f37; margin: 0 0 8px; font-family: 'Montserrat', Arial, sans-serif; font-weight:700; font-size:19px;">
      About the Theme: INVISIBLE
    </h3>
    <p style="font-family:'Roboto Slab', serif; font-size:16px; line-height:1.8; color:#f4f4f4;">
      This year, as HITAM celebrates
      <span style="color:#ffdf4f;">25 years of academic excellence & transformative impact</span>,
      TEDxHITAM 2025's theme <b>'Invisible'</b> shines a light on untold stories, silent efforts, and the hidden forces shaping remarkable outcomes.<br>
      Let's honor unseen thoughts, sacrifices, and endurance—the journey that truly builds success. It's a tribute to people, choices, and challenges that make greatness possible behind the scenes.
    </p>
  </section>

  <!-- Speaker Announcement -->
  <div style="background:rgba(255,223,79,0.16); padding:12px 20px; border-radius:11px; text-align:center; margin:18px 0 10px 0;">
    <span style="color:#ffdf4f; font-weight:700;">Meet Our Speakers at <a href="https://tedxhitam.com/speakers" target="_blank" style="color:#fff; text-decoration:none;">tedxhitam.com/speakers</a></span>
  </div>
  
  <div style="background:rgba(255,223,79,0.16); padding:12px 20px; border-radius:11px; text-align:center; margin:18px 0 10px 0;">
    <span style="color:#ffdf4f; font-weight:700;">Dress Code: <span style="color:#fff;">Business Formal</span></span>
  </div>

  <!-- Calendar Button -->
  <div style="text-align: center; margin: 32px 0 24px 0;">
    <a 
      href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=TEDxHITAM+2025+-+Invisible&dates=20250920T043000Z/20250920T103000Z&details=TEDxHITAM's+3rd+edition+under+the+theme+'Invisible'.+Faculty+reception+at+9:30+AM.+Venue:+HITAM+Auditorium&location=HITAM+Auditorium&sf=true&output=xml"
      target="_blank"
      style="display:inline-block; padding:12px 30px; border-radius:25px; background:linear-gradient(90deg,#c71f37,#181823); color:#fff; font-weight:700; text-decoration:none; font-family:'Montserrat',Arial,sans-serif; margin:12px auto; box-shadow:0 2px 8px rgba(199,31,55,0.2);"
    >
      Add to Calendar
    </a>
  </div>
  
  <!-- Faculty Instructions -->
  <div style="background:rgba(255,223,79,0.16); padding:20px; border-radius:11px; margin:24px 0;">
    <h3 style="font-size:18px; margin-bottom:16px; text-decoration:underline;">Faculty Guidelines</h3>
    
    <div style="margin-bottom:12px;">
      <span style="color:#ffdf4f; font-weight:700;">Faculty Reception: </span>
      <span style="color:#fff;">9:30 AM at HITAM Auditorium</span>
    </div>
    

    <div style="margin-bottom:12px;">
      <span style="color:#ffdf4f; font-weight:700;">Reserved Seating: </span>
      <span style="color:#fff;">Premium seating arrangements in the front rows</span>
    </div>
    
    <div style="margin-bottom:12px;">
      <span style="color:#ffdf4f; font-weight:700;">1. </span>
      <span style="color:#fff;">Please carry your faculty ID for priority access</span>
    </div>
    
    <div style="margin-bottom:12px;">
      <span style="color:#ffdf4f; font-weight:700;">2. </span>
      <span style="color:#fff;">Networking session with speakers post-event</span>
    </div>
    
    <div>
      <span style="color:#ffdf4f; font-weight:700;">3. </span>
      <span style="color:#fff;">Your participation inspires students and fellow faculty</span>
    </div>
  </div>

  <!-- Event Info Card -->
  <div style="font-family:'Montserrat', Arial, sans-serif; text-align: left;">
    <span style="display:inline-block; background:#c71f37; color:#fff; border-radius:9px 9px 0 0; padding:8px 20px; letter-spacing: 0.5px; font-weight: 700; font-size: 16px;">
      Event Details
    </span>
    <div style="background:#232342; color:#fff; border-radius:0 13px 13px 13px; padding:20px 25px; margin-bottom:18px; box-shadow: 0 5px 15px rgba(0,0,0,0.25);">
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-calendar-days" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Date:</b> <span style="color:#ffdf4f;">20th September 2025</span></span>
      </div>
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-clock" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Time:</b> 10:00 AM onwards</span>
      </div>
      <div style="display:flex; align-items:center; margin-bottom:14px; font-size:16px;">
        <i class="fas fa-users" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Faculty Reception:</b> 9:30 AM</span>
      </div>
      <div style="display:flex; align-items:center; font-size:16px;">
        <i class="fas fa-map-marker-alt" style="color:#ffdf4f; font-size:18px; margin-right:15px; width:20px; text-align:center;"></i>
        <span><b>Venue:</b> <span style="color:#c71f37; font-weight:bold;">HITAM Auditorium</span></span>
      </div>
    </div>
  </div>

  <!-- Social Links -->
  <p style="text-align:center; color:#aaa; font-size:15px; margin-top:18px;">
    Follow us for instant updates:<br>
    <b>
      <a href="https://www.instagram.com/tedxhitam/" target="_blank" style="color:#c71f37; text-decoration:none;">
        <i class="fab fa-instagram"></i> Instagram
      </a>
    </b>
  </p>

  <!-- Closing Section -->
  <p style="text-align: center; font-size:18px; color:#ffdf4f; margin-top:24px; letter-spacing:0.6px;">
    Thank you for your distinguished leadership and continued excellence!
  </p>
  <p style="text-align: center; color: #aaa; font-size:16px; margin-bottom: 7px; font-family: 'Montserrat', Arial, sans-serif; letter-spacing: 0.7px;">
    Your guidance and wisdom are the <b>INVISIBLE</b> pillars that elevate our institution.
  </p>
  <p style="text-align: center; font-style: italic; color:#fff; font-family:'Roboto Slab', serif; font-size: 16px;">
    – Team TEDxHITAM
  </p>

</div> <!-- End of Body Content -->
</div> <!-- End of Main Wrapper -->`,
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Sent to ${row.email}`);
        sentCount++;
      } catch (mailErr) {
        console.error(`❌ Failed to send to ${row.email}:`, mailErr);
      }
    }

    res.json({ message: `Bulk mail completed. Sent to ${sentCount}/${rows.length} members.` });
  } catch (err) {
    console.error("💥 Error in /send-mails:", err);
    res.status(500).json({ error: "Bulk mail failed" });
  }
});





// ✅ Root Route
app.get("/", (req, res) => {
  res.send("🚀 TEDx API is live Now");
});



// ❌ 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "❌ Route not found" });
});

// 🚀 Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
