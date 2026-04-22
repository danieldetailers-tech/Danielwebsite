-- Cloudflare D1 schema for Daniel’s Detailers

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

