-- D1: daniels_scheduling — appointments & scheduling (separate from reviews DB)

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

CREATE INDEX IF NOT EXISTS idx_appointment_reservations_isoDate ON appointment_reservations(isoDate);
