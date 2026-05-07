# Detailing by Daniel - Coder Instructions

This document explains how to safely update this project, including:

- Pulling latest code from GitHub
- Editing scheduling logic (dates and allowed times)
- Running migrations and deployment
- Pushing code back to GitHub
- Admin scheduling maintenance tasks

Use this as the standard operating guide for future updates.

---

## 1) Project Overview

Important files and what they control:

- `index.html`: Main public website
- `app.js`: Public scheduling form logic (customer side)
- `admin.html`: Admin dashboard UI
- `admin.js`: Admin login and appointment management UI logic
- `styles.css`: Shared styling
- `src/worker.js`: Cloudflare Worker API (reviews, bookings, admin auth)
- `wrangler.toml`: Worker config and D1 bindings
- `migrations/scheduling/*.sql`: Scheduling database migrations

Databases in use:

- `DB` binding -> `daniels_detailers` (reviews + legacy)
- `SCHEDULING` binding -> `daniels_scheduling` (appointments)

---

## 2) Prerequisites

Before coding, make sure:

1. Node.js is installed
2. You are in the repo directory:
   - `C:\Users\Sanab\OneDrive\Daniel's Detailing Business`
3. You can run Wrangler through npm:
   - `npx wrangler --version`

---

## 3) Safe Git Workflow (Pull -> Edit -> Commit -> Push)

### A. Check current branch and local changes

```powershell
git status
git branch
```

If there are uncommitted changes you want to keep, commit them first before pulling.

### B. Pull latest code from GitHub

```powershell
git pull origin main
```

If your default branch is not `main`, replace with your branch name.

### C. Create a feature branch (recommended)

```powershell
git checkout -b feature/update-scheduling-rules
```

### D. Make code edits

Edit files, then run:

```powershell
git status
git diff
```

### E. Commit your changes

```powershell
git add .
git commit -m "Update scheduling rules and admin workflow"
```

### F. Push to GitHub

```powershell
git push -u origin feature/update-scheduling-rules
```

If working directly on main:

```powershell
git push origin main
```

---

## 4) How to Edit Scheduling Dates and Time Availability

Primary file: `app.js`

### A. Change first available booking date

Find:

- `const APPOINTMENTS_OPEN_ISO = "YYYY-MM-DD";`

Set to desired date in ISO format:

- Example: `const APPOINTMENTS_OPEN_ISO = "2026-07-01";`

This blocks customers from selecting dates before that day.

### B. Change day/time slot rules

Find function:

- `getAllowedAppointmentSlotsForISODate(iso)`

Current logic controls which times are shown by day of week:

- Monday/Tuesday blocked
- Wed-Fri limited times
- Sunday blocked
- Saturday specific times

Update the returned arrays to modify available times.

Examples:

- Add Friday 7:30 PM slot -> include `"19:30"` in Wed-Fri array
- Allow Sunday noon -> return `["12:00"]` for Sunday
- Open Monday fully -> remove Monday from blocked condition

Important format:

- Time strings must be 24-hour `HH:MM` (example: `14:30`)

### C. Ensure backend accepts expected format

The API validates with `isTimeHHMM()` in:

- `src/worker.js`

Do not send AM/PM strings to the API.

---

## 5) Admin Scheduling Features (Add/Cancel/Override)

Admin files:

- `admin.html`
- `admin.js`
- `src/worker.js`

Admin endpoints:

- `POST /api/admin/login`
- `GET /api/admin/appointments?date=YYYY-MM-DD`
- `POST /api/admin/appointments`
- `DELETE /api/admin/appointments/:id`
- `POST /api/admin/availability`

Availability override behavior:

- `isAvailable = 0` -> blocked slot (customer cannot select)
- `isAvailable = 1` -> forced open slot

Database table:

- `appointment_availability_overrides`

---

## 6) Secrets and Environment Setup

Admin auth requires these Worker secrets:

- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

Set or update values:

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

Notes:

- Running `secret put` again overwrites the previous value
- No new `wrangler.toml` binding is needed for secrets

---

## 7) Running D1 Migrations

When adding/changing SQL files in `migrations/scheduling`, apply them:

```powershell
npx wrangler d1 migrations apply daniels_scheduling --remote
```

Verify tables:

```powershell
npx wrangler d1 execute daniels_scheduling --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

---

## 8) Deploy Workflow

After code changes are complete:

```powershell
npx wrangler deploy
```

If public site files changed (`index.html`, `app.js`, `styles.css`, `admin.html`, `admin.js`), ensure hosting receives those static file updates using your normal website deployment path.

---

## 9) Quick Test Checklist After Changes

### Public scheduling

1. Open main site
2. Select date
3. Confirm allowed times reflect new rules
4. Submit booking
5. Confirm booking disappears from available slots

### Admin flow

1. Open `admin.html`
2. Login with admin password
3. Load date
4. Add appointment
5. Cancel appointment
6. Block slot and verify customer cannot select it
7. Force-open slot and verify it reappears

---

## 10) Common Issues and Fixes

### "Unauthorized" on admin calls

- Token missing or expired -> log in again
- Secrets not set -> run `wrangler secret put ...` and redeploy

### D1 table not found

- Migration not applied -> run migrations command

### PowerShell SQL parse errors

- Do not paste raw SQL directly as shell commands
- Use `wrangler d1 execute ... --command "SQL HERE"`

### Booking time rejected

- Ensure time format is `HH:MM` (24-hour)
- Confirm frontend slot values and backend validation match

---

## 11) Suggested Branch Naming

Use clear names:

- `feature/admin-improvements`
- `feature/scheduling-rules-update`
- `fix/appointment-validation`
- `chore/docs-coder-notes`

---

## 12) Suggested Commit Message Style

Use concise, purpose-first messages:

- `Add admin schedule management endpoints and UI`
- `Update appointment slot rules for weekend availability`
- `Add scheduling migration for availability overrides`
- `Document deployment and Git workflow for maintainers`

