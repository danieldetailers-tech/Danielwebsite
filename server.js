const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
  process.exit(1);
});

// Serve the static website (index.html, styles.css, app.js, assets/, etc.)
app.use(express.static(__dirname, { extensions: ["html"] }));
app.use(express.json({ limit: "50kb" }));

const DATA_DIR = path.join(__dirname, "data");
const REVIEWS_DB_FILE = path.join(DATA_DIR, "reviews.sqlite");

function openDb() {
  // Ensure the directory exists (sync is fine at startup).
  require("fs").mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(REVIEWS_DB_FILE);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_createdAt ON reviews(createdAt);

    CREATE TABLE IF NOT EXISTS appointment_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isoDate TEXT NOT NULL,
      time TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      clientFirstName TEXT,
      clientLastName TEXT,
      clientPhone TEXT,
      clientEmail TEXT,
      notes TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_appt_slot ON appointment_reservations(isoDate, time);
  `);
  return db;
}

const db = openDb();

function listReviews() {
  return db
    .prepare(
      `SELECT id, firstName, lastName, rating, comment, createdAt
       FROM reviews
       ORDER BY datetime(createdAt) ASC, id ASC`,
    )
    .all();
}

function insertReview({ firstName, lastName, rating, comment }) {
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO reviews (firstName, lastName, rating, comment, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(firstName, lastName, rating, comment, createdAt);
  return { id: Number(info.lastInsertRowid), firstName, lastName, rating, comment, createdAt };
}

function clampStr(s, maxLen) {
  const v = String(s || "").trim();
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function isIsoDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || "").trim());
}

function isTimeHHMM(t) {
  return /^\d{2}:\d{2}$/.test(String(t || "").trim());
}

function listBookedTimesForDate(isoDate) {
  return db
    .prepare(`SELECT time FROM appointment_reservations WHERE isoDate = ? ORDER BY time ASC, id ASC`)
    .all(isoDate)
    .map((r) => r.time);
}

function reserveSlot({ isoDate, time, clientFirstName, clientLastName, clientPhone, clientEmail, notes }) {
  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO appointment_reservations
       (isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes);
  return { id: Number(info.lastInsertRowid), isoDate, time, createdAt };
}

// Basic anti-spam rate limit (in-memory): max 3 review posts per 10 minutes per IP.
const reviewPostsByIp = new Map();
function tooManyRecentReviewPosts(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 3;
  const existing = reviewPostsByIp.get(ip) || [];
  const fresh = existing.filter((t) => now - t < windowMs);
  if (fresh.length >= max) return true;
  fresh.push(now);
  reviewPostsByIp.set(ip, fresh);
  return false;
}

app.get("/api/reviews", (_req, res) => {
  try {
    const reviews = listReviews();
    res.status(200).json({ ok: true, reviews });
  } catch (err) {
    console.error("GET /api/reviews failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load reviews." });
  }
});

app.post("/api/reviews", (req, res) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (tooManyRecentReviewPosts(ip)) {
      res.status(429).json({ ok: false, error: "Too many reviews from this device. Please try again later." });
      return;
    }

    const firstName = clampStr(req.body?.firstName, 50);
    const lastName = clampStr(req.body?.lastName, 50);
    const rating = Number(req.body?.rating);
    const comment = clampStr(req.body?.comment, 800);

    if (!firstName || !lastName || !Number.isFinite(rating) || rating < 1 || rating > 5 || !comment) {
      res.status(400).json({ ok: false, error: "Invalid review." });
      return;
    }

    const newReview = insertReview({ firstName, lastName, rating, comment });

    res.status(201).json({ ok: true, review: newReview });
  } catch (err) {
    console.error("POST /api/reviews failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save review." });
  }
});

app.get("/api/appointments/booked", (req, res) => {
  try {
    const isoDate = String(req.query?.date || "").trim();
    if (!isIsoDate(isoDate)) {
      res.status(400).json({ ok: false, error: "Missing or invalid date (YYYY-MM-DD)." });
      return;
    }
    const bookedTimes = listBookedTimesForDate(isoDate);
    res.status(200).json({ ok: true, date: isoDate, bookedTimes });
  } catch (err) {
    console.error("GET /api/appointments/booked failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load booked appointments." });
  }
});

app.post("/api/appointments/reserve", (req, res) => {
  try {
    const isoDate = String(req.body?.date || "").trim();
    const time = String(req.body?.time || "").trim();

    if (!isIsoDate(isoDate) || !isTimeHHMM(time)) {
      res.status(400).json({ ok: false, error: "Invalid reservation payload." });
      return;
    }

    // Store a small subset for your internal reference (optional).
    const clientFirstName = clampStr(req.body?.firstName, 50);
    const clientLastName = clampStr(req.body?.lastName, 50);
    const clientPhone = clampStr(req.body?.phone, 30);
    const clientEmail = clampStr(req.body?.email, 120);
    const notes = clampStr(req.body?.notes, 400);

    try {
      const reservation = reserveSlot({
        isoDate,
        time,
        clientFirstName,
        clientLastName,
        clientPhone,
        clientEmail,
        notes,
      });
      res.status(201).json({ ok: true, reservation });
    } catch (e) {
      // Unique constraint => already booked.
      if (String(e && e.code) === "SQLITE_CONSTRAINT_UNIQUE") {
        res.status(409).json({ ok: false, error: "That time slot has already been booked. Please pick another time." });
        return;
      }
      throw e;
    }
  } catch (err) {
    console.error("POST /api/appointments/reserve failed:", err);
    res.status(500).json({ ok: false, error: "Failed to reserve appointment slot." });
  }
});

// Health check for Railway
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Root route (explicit)
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

