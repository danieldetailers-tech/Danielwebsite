-- Admin availability overrides for scheduling controls.
CREATE TABLE IF NOT EXISTS appointment_availability_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isoDate TEXT NOT NULL,
  time TEXT NOT NULL,
  isAvailable INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  createdAt TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_unique
ON appointment_availability_overrides(isoDate, time);
