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
    user: "info@tedxhitam.com",
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
