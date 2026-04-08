const path = require("path");
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

