const path = require("path");
const fs = require("fs/promises");
const fssync = require("fs");
const express = require("express");

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
const REVIEWS_FILE = path.join(DATA_DIR, "reviews.json");

async function ensureReviewsFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!fssync.existsSync(REVIEWS_FILE)) {
    await fs.writeFile(REVIEWS_FILE, "[]", "utf8");
  }
}

async function readReviews() {
  await ensureReviewsFile();
  const raw = await fs.readFile(REVIEWS_FILE, "utf8");
  const parsed = JSON.parse(raw || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

async function writeReviews(reviews) {
  await ensureReviewsFile();
  const tmp = `${REVIEWS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(reviews, null, 2), "utf8");
  await fs.rename(tmp, REVIEWS_FILE);
}

function clampStr(s, maxLen) {
  const v = String(s || "").trim();
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

app.get("/api/reviews", async (_req, res) => {
  try {
    const reviews = await readReviews();
    res.status(200).json({ ok: true, reviews });
  } catch (err) {
    console.error("GET /api/reviews failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load reviews." });
  }
});

app.post("/api/reviews", async (req, res) => {
  try {
    const firstName = clampStr(req.body?.firstName, 50);
    const lastName = clampStr(req.body?.lastName, 50);
    const rating = Number(req.body?.rating);
    const comment = clampStr(req.body?.comment, 1000);

    if (!firstName || !lastName || !Number.isFinite(rating) || rating < 1 || rating > 5 || !comment) {
      res.status(400).json({ ok: false, error: "Invalid review." });
      return;
    }

    const newReview = { firstName, lastName, rating, comment, createdAt: new Date().toISOString() };
    const reviews = await readReviews();
    reviews.push(newReview);
    await writeReviews(reviews);

    res.status(201).json({ ok: true, review: newReview });
  } catch (err) {
    console.error("POST /api/reviews failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save review." });
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

