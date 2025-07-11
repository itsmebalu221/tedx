// server.js
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');
const bodyParser=require('body-parser');
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());

app.use(bodyParser.json()); // handles JSON
app.use(bodyParser.urlencoded({ extended: true })); // handles form data


app.use('/public',express.static(__dirname+"/public"))


// ✅ POST API to insert user

app.get("/", async (req,res)=>{
  res.send("Hi From Backend This is Balaji")
  
})

// app.get("/nearst",async(req,res)=>{
//   const nearst=await sql.query`DECLARE @userLocation GEOGRAPHY = geography::Point(17.389269, 78.500868, 4326);

// SELECT SNO ,PLACE_NAME,
//        Location.STDistance(@userLocation) AS DistanceInMeters
// FROM Places
// WHERE Location.STDistance(@userLocation) <= 5000;`
//   res.status(200).json({message:"sucess",places:nearst.recordset})
// })

// app.get("/placesMain",async(req,res)=>{
//   try{
//     const places=await sql.query`SELECT PlaceID,PlaceName,State,ImageURL,Category FROM PlacesMain`
//     res.status(200).send(places.recordset)
//   }catch(err){
//     console.log(err)
//   }
  
// })

// app.get("/placesMain/:placeName",async(req,res)=>{
//   const placeName=req.params.placeName;
//   try{
//     const places=await sql.query`SELECT * FROM PlacesMain WHERE PlaceID=${placeName}`
//     res.status(200).send(places.recordset[0])
//   }catch(err){
//     console.log(err)
//   }
  
// })

// app.get("/images/:imgName", (req, res) => {
//   const imgName = req.params.imgName;
//   const imgPath = path.join(__dirname, 'images', imgName);

//   res.sendFile(imgPath, (err) => {
//     if (err) {
//       console.error("Error sending file:", err);
//       res.status(404).send("Image not found");
//     }
//   });
// });

// app.get("/ttd/:id", async (req, res) => {
//   const id = req.params.id;
//   try {
//     const result = await sql.query`SELECT Activity FROM ThingsToDo WHERE PlaceID=${id}`;
//     if (result.recordset.length === 0) {
//       return res.status(404).send("Data Not Found");
//     }
//     res.status(200).send(result.recordset);
//   } catch (err) {
//     console.error("Error fetching  data:", err);
//     res.status(500).send("Internal Server Error");
//   }
// });

// app.get("/home",(req,res)=>{

//   res.sendFile(__dirname+"/image.png")
// })
// // ✅ GET API to check login (static for now)
// app.get('/login', async (req, res) => {
//   const user_id = "balaji";
//   const password = "password";

//   if (!user_id || !password) {
//     return res.status(400).json({ message: 'Missing user_id or password' });
//   }

//   try {
//     const result = await sql.query`
//       SELECT * FROM users 
//       WHERE user_id = ${user_id} AND password = ${password}
//     `;

//     if (result.recordset.length > 0) {
//       res.status(200).json({ success: true, user: result.recordset[0] });
//     } else {
//       res.status(401).json({ success: false, message: 'Invalid credentials' });
//     }
//   } catch (err) {
//     console.error('❌ SQL error', err);
//     res.status(500).json({ success: false, message: 'Database error' });
//   }
// });


// // Function to generate random 5-char string for table name
// function generateRandomTableName(length = 5) {
//   const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
//   let result = '';
//   for(let i = 0; i < length; i++) {
//     result += chars.charAt(Math.floor(Math.random() * chars.length));
//   }
//   return result;
// }

// app.post('/upload-csv', upload.single('file'), (req, res) => {
//   if (!req.file) {
//     return res.status(400).send('No file uploaded.');
//   }

//   const results = [];
//   const tableName = generateRandomTableName();

//   fs.createReadStream(req.file.path)
//     .pipe(csv())
//     .on('data', (data) => results.push(data))
//     .on('end', async () => {
//       try {
//         const pool = await sql.connect(config);

//         // Create table with the structure matching the CSV columns
//         const createTableQuery = `
//           CREATE TABLE [${tableName}] (
//             id INT IDENTITY(1,1) PRIMARY KEY,
//             timestamp DATETIME,
//             log_level VARCHAR(10),
//             source VARCHAR(50),
//             message TEXT,
//             user_id INT,
//             ip_address VARCHAR(50),
//             status_code INT
//           )
//         `;

//         await pool.request().query(createTableQuery);

//         // Insert CSV rows into the newly created table
//         for (const log of results) {
//           await pool.request()
//             .input('timestamp', sql.DateTime, new Date(log.timestamp))
//             .input('log_level', sql.VarChar(10), log.log_level)
//             .input('source', sql.VarChar(50), log.source)
//             .input('message', sql.Text, log.message)
//             .input('user_id', sql.Int, parseInt(log.user_id) || null)
//             .input('ip_address', sql.VarChar(50), log.ip_address)
//             .input('status_code', sql.Int, parseInt(log.status_code) || null)
//             .query(`
//               INSERT INTO [${tableName}]
//               (timestamp, log_level, source, message, user_id, ip_address, status_code)
//               VALUES (@timestamp, @log_level, @source, @message, @user_id, @ip_address, @status_code)
//             `);
//         }

//         // Remove uploaded file after processing
//         fs.unlinkSync(req.file.path);

//         res.status(200).send(`Table '${tableName}' created and inserted ${results.length} records successfully.`);
//       } catch (err) {
//         console.error('❌ Error:', err);
//         res.status(500).send('Error creating table or inserting data.');
//       }
//     });
// });

// app.post('/MoneyRequest', (req, res) => {
//   const { requestFrom, requestedBy, amount, note, ipAddress, timestamp } = req.body;

//   const query = `
//     INSERT INTO MoneyRequests 
//     (requestFrom, requestedBy, amount, note, ipAddress, timestamp)
//     VALUES (?, ?, ?, ?, ?, ?)
//   `;

//   db.query(query, [requestFrom, requestedBy, amount, note, ipAddress, timestamp], (err, result) => {
//     if (err) {
//       console.error('❌ Error inserting data:', err.message);
//       return res.status(500).json({ success: false, message: 'Database insert failed' });
//     }

//     res.status(200).json({ success: true, message: 'Money request saved successfully' });
//   });
// });

// Start server
app.listen(port,"0.0.0.0", () => {
  console.log(`✅ Server running on port ${port}`);
});
