const express = require("express");
const { MongoClient } = require("mongodb");

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const UGA_API_URL = "https://apps.auxiliary.uga.edu/Dining/OccupancyCounter/api/occupancy.php";

// --- SET UP EXPRESS SERVER ---
const app = express();

// --- CONNECT TO MONGODB ---
let db;
const client = new MongoClient(MONGODB_URI);

async function connectDB() {
  try {
    await client.connect();
    db = client.db("dining");           // database name
    console.log("Connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

// --- FETCH AND SAVE OCCUPANCY DATA ---
async function fetchAndSave() {
  try {
    // Step 1: Ask the UGA API for current occupancy data
    const response = await fetch(UGA_API_URL);
    const data = await response.json();

    // Step 2: Check if the system is even enabled
    if (!data.isEnabled) {
      console.log("Occupancy counter is disabled, skipping...");
      return;
    }

    // Step 3: Get the current time in Eastern Time (Georgia time zone)
    const now = new Date();
    const estString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const estDate = new Date(estString);

    // Step 4: Build one record (row of data) with all 5 dining halls
    const record = {
      timestamp: now,                                   // exact time (stored in database's format)
      date: estDate.toLocaleDateString("en-US"),        // like "3/30/2026"
      time: estDate.toLocaleTimeString("en-US"),        // like "11:35:00 AM"
      dayOfWeek: estDate.toLocaleDateString("en-US", { weekday: "long" }), // like "Monday"
      bolton: data.diningHalls.bolton.availability,
      oglethorpe: data.diningHalls.ohouse.availability,
      niche: data.diningHalls.scott.availability,
      snelling: data.diningHalls.snelling.availability,
      villageSummit: data.diningHalls.summit.availability
    };

    // Step 5: Save the record to MongoDB
    await db.collection("occupancy").insertOne(record);
    console.log(`Saved: ${record.date} ${record.time} | Bolton: ${record.bolton}% | Oglethorpe: ${record.oglethorpe}% | Niche: ${record.niche}% | Snelling: ${record.snelling}% | Summit: ${record.villageSummit}%`);

  } catch (err) {
    console.error("Error fetching/saving:", err);
  }
}

// --- ROUTES (pages you can visit) ---

// Home page - just shows the server is running
app.get("/", (req, res) => {
  res.send("UGA Dining Tracker is running! Visit /download to get your data as CSV.");
});

// Ping route - UptimeRobot will hit this every 5 minutes
// Each ping ALSO triggers a data fetch, so we collect data every 5 minutes for free
app.get("/ping", async (req, res) => {
  await fetchAndSave();
  res.send("Pinged and data collected!");
});
// Data preview route - view latest data in your browser
app.get("/data", async (req, res) => {
  try {
    // Grab the most recent 50 records, newest first
    const records = await db.collection("occupancy").find({}).sort({ timestamp: -1 }).limit(50).toArray();

    if (records.length === 0) {
      res.send("No data collected yet!");
      return;
    }

    // Build a simple HTML table
    let html = `
      <html>
      <head>
        <title>UGA Dining Occupancy Data</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
          th { background-color: #BA0C2F; color: white; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          h1 { color: #BA0C2F; }
        </style>
      </head>
      <body>
        <h1>UGA Dining Hall Occupancy</h1>
        <p>Showing last ${records.length} readings (newest first)</p>
        <p><a href="/download">Download full CSV</a></p>
        <table>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Day</th>
            <th>Bolton</th>
            <th>Oglethorpe</th>
            <th>Niche</th>
            <th>Snelling</th>
            <th>Village Summit</th>
          </tr>`;

    for (const r of records) {
      html += `
          <tr>
            <td>${r.date}</td>
            <td>${r.time}</td>
            <td>${r.dayOfWeek}</td>
            <td>${r.bolton}%</td>
            <td>${r.oglethorpe}%</td>
            <td>${r.niche}%</td>
            <td>${r.snelling}%</td>
            <td>${r.villageSummit}%</td>
          </tr>`;
    }

    html += `
        </table>
      </body>
      </html>`;

    res.send(html);
  } catch (err) {
    console.error("Error displaying data:", err);
    res.status(500).send("Error displaying data");
  }
});
// Download route - visit this to download all collected data as a CSV file
app.get("/download", async (req, res) => {
  try {
    // Grab ALL records from the database, sorted oldest to newest
    const records = await db.collection("occupancy").find({}).sort({ timestamp: 1 }).toArray();

    if (records.length === 0) {
      res.send("No data collected yet! Check back after the server has been pinged a few times.");
      return;
    }

    // Build CSV content
    // First line is the header row (column names)
    let csv = "Date,Time,Day,Bolton,Oglethorpe,Niche,Snelling,Village Summit\n";

    // Each record becomes one row
    for (const r of records) {
      csv += `${r.date},${r.time},${r.dayOfWeek},${r.bolton},${r.oglethorpe},${r.niche},${r.snelling},${r.villageSummit}\n`;
    }

    // Tell the browser "this is a file download, not a web page"
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=uga-dining-occupancy.csv");
    res.send(csv);

  } catch (err) {
    console.error("Error generating CSV:", err);
    res.status(500).send("Error generating CSV");
  }
});

// --- START THE SERVER ---
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Do one fetch right away when the server starts
    fetchAndSave();

    // Then fetch every 5 minutes automatically (5 * 60 * 1000 = 300000 milliseconds)
    setInterval(fetchAndSave, 5 * 60 * 1000);
    console.log("Auto-fetch scheduled every 5 minutes");
  });
});
