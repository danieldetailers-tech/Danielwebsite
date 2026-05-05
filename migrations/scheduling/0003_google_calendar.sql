-- Store Google Calendar event metadata for reservations (optional but useful).
ALTER TABLE appointment_reservations ADD COLUMN googleEventId TEXT;
ALTER TABLE appointment_reservations ADD COLUMN googleEventLink TEXT;

