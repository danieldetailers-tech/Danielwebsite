function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

const ADMIN_TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function assertEnvString(env, key) {
  const v = String(env?.[key] ?? "").trim();
  return v ? v : null;
}

function withCors(req, res, { allowOrigin } = {}) {
  const origin = req.headers.get("Origin");
  const headers = new Headers(res.headers);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");

  // For a public website, reflecting Origin is usually OK.
  // If you want to lock this down, replace with your domain(s).
  if (allowOrigin) headers.set("Access-Control-Allow-Origin", allowOrigin);
  else if (origin) headers.set("Access-Control-Allow-Origin", origin);
  else headers.set("Access-Control-Allow-Origin", "*");

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function clampStr(s, maxLen) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function isIsoDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "").trim());
}

function isTimeHHMM(t) {
  return /^\d{2}:\d{2}$/.test(String(t ?? "").trim());
}

function isUniqueConstraintError(err) {
  const msg = String(err?.message || "");
  return msg.toLowerCase().includes("unique constraint failed");
}

async function getBookedTimesWithOverrides(env, isoDate) {
  const basicQuery = env.SCHEDULING.prepare(
    `SELECT time FROM appointment_reservations WHERE isoDate = ? ORDER BY time ASC, id ASC`,
  ).bind(isoDate);
  try {
    const { results } = await env.SCHEDULING.prepare(
      `SELECT time FROM appointment_reservations WHERE isoDate = ?
       UNION
       SELECT time FROM appointment_availability_overrides WHERE isoDate = ? AND isAvailable = 0
       EXCEPT
       SELECT time FROM appointment_availability_overrides WHERE isoDate = ? AND isAvailable = 1
       ORDER BY time ASC`,
    )
      .bind(isoDate, isoDate, isoDate)
      .all();
    return (results || []).map((r) => r.time).filter(Boolean);
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("no such table")) {
      const { results } = await basicQuery.all();
      return (results || []).map((r) => r.time).filter(Boolean);
    }
    throw err;
  }
}

function toBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(base64url) {
  const b64 = String(base64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pemToDerBytes(pem) {
  const text = String(pem || "").trim();
  const body = text
    .replace(/-----BEGIN ([A-Z ]+)-----/g, "")
    .replace(/-----END ([A-Z ]+)-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function googleServiceAccountAccessToken(env, { scope }) {
  const serviceAccountEmail = assertEnvString(env, "GOOGLE_SERVICE_ACCOUNT_EMAIL");
  let privateKeyPem = assertEnvString(env, "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (privateKeyPem) privateKeyPem = privateKeyPem.replace(/\\n/g, "\n");
  if (!serviceAccountEmail || !privateKeyPem) return { ok: false, error: "Google service account is not configured." };

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: serviceAccountEmail,
    scope,
    aud: tokenUrl,
    iat: now,
    exp: now + 60 * 60,
  };

  const unsignedJwt = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(claimSet))}`;
  const pkcs8Der = pemToDerBytes(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsignedJwt));
  const signedJwt = `${unsignedJwt}.${toBase64Url(new Uint8Array(sigBuf))}`;

  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", signedJwt);

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("Google OAuth token error:", res.status, txt);
    return { ok: false, error: "Failed to authenticate to Google Calendar." };
  }
  const data = await res.json().catch(() => null);
  const accessToken = String(data?.access_token || "").trim();
  if (!accessToken) return { ok: false, error: "Google OAuth token response missing access_token." };
  return { ok: true, accessToken };
}

function addMinutesToHHMM(hhmm, minutesToAdd) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const total = h * 60 + m + Number(minutesToAdd || 0);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

async function createGoogleCalendarEventForReservation(env, reservation) {
  const calendarId = assertEnvString(env, "GOOGLE_CALENDAR_ID");
  if (!calendarId) return { ok: false, error: "Google Calendar ID is not configured." };

  const timeZone = assertEnvString(env, "GOOGLE_CALENDAR_TIME_ZONE") || "America/Los_Angeles";
  const durationMins = Number(env?.APPOINTMENT_DURATION_MINUTES || 240);
  const endTime = addMinutesToHHMM(reservation.time, durationMins) || reservation.time;

  const startLocal = `${reservation.isoDate}T${reservation.time}:00`;
  const endLocal = `${reservation.isoDate}T${endTime}:00`;

  const name = [reservation.clientFirstName, reservation.clientLastName].filter(Boolean).join(" ").trim();
  const title = name ? `Detailing — ${name}` : "Detailing appointment";
  const descriptionLines = [
    "Detailing by Daniel appointment",
    reservation.clientPhone ? `Phone: ${reservation.clientPhone}` : null,
    reservation.clientEmail ? `Email: ${reservation.clientEmail}` : null,
    reservation.notes ? `Notes: ${reservation.notes}` : null,
    reservation.id ? `Reservation ID: ${reservation.id}` : null,
  ].filter(Boolean);

  const token = await googleServiceAccountAccessToken(env, { scope: "https://www.googleapis.com/auth/calendar.events" });
  if (!token.ok) return token;

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const payload = {
    summary: title,
    description: descriptionLines.join("\n"),
    start: { dateTime: startLocal, timeZone },
    end: { dateTime: endLocal, timeZone },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("Google Calendar insert error:", res.status, txt);
    return { ok: false, error: "Failed to create Google Calendar event." };
  }
  const data = await res.json().catch(() => null);
  const eventId = String(data?.id || "").trim() || null;
  const htmlLink = String(data?.htmlLink || "").trim() || null;
  return { ok: true, eventId, htmlLink };
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret || "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}

async function issueAdminToken(env) {
  const now = Date.now();
  const payload = {
    sub: "admin",
    iat: now,
    exp: now + ADMIN_TOKEN_TTL_MS,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = await hmacSign(payloadB64, env.ADMIN_SESSION_SECRET);
  return `${payloadB64}.${sig}`;
}

async function verifyAdminToken(env, token) {
  const raw = String(token || "").trim();
  if (!raw.includes(".")) return false;
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return false;
  const expectedSig = await hmacSign(payloadB64, env.ADMIN_SESSION_SECRET);
  if (sig !== expectedSig) return false;
  try {
    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(payloadJson);
    if (payload?.sub !== "admin") return false;
    if (!Number.isFinite(payload?.exp) || payload.exp <= Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

async function requireAdmin(req, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return { ok: false, response: json({ ok: false, error: "Admin auth secrets are not configured." }, { status: 500 }) };
  }
  const header = String(req.headers.get("Authorization") || "").trim();
  if (!header.startsWith("Bearer ")) {
    return { ok: false, response: json({ ok: false, error: "Unauthorized." }, { status: 401 }) };
  }
  const token = header.slice("Bearer ".length).trim();
  const valid = await verifyAdminToken(env, token);
  if (!valid) return { ok: false, response: json({ ok: false, error: "Unauthorized." }, { status: 401 }) };
  return { ok: true };
}

async function handleReviews(req, env) {
  if (!env.DB) return json({ ok: false, error: "DB binding is not configured." }, { status: 500 });

  if (req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, firstName, lastName, rating, comment, createdAt
       FROM reviews
       ORDER BY datetime(createdAt) ASC, id ASC`,
    ).all();
    return json({ ok: true, reviews: results || [] }, { status: 200 });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    const firstName = clampStr(body?.firstName, 50);
    const lastName = clampStr(body?.lastName, 50);
    const rating = Number(body?.rating);
    const comment = clampStr(body?.comment, 800);
    if (!firstName || !lastName || !Number.isFinite(rating) || rating < 1 || rating > 5 || !comment) {
      return json({ ok: false, error: "Invalid review." }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const info = await env.DB.prepare(
      `INSERT INTO reviews (firstName, lastName, rating, comment, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(firstName, lastName, rating, comment, createdAt)
      .run();

    const id = Number(info?.meta?.last_row_id ?? 0);
    return json({ ok: true, review: { id, firstName, lastName, rating, comment, createdAt } }, { status: 201 });
  }

  return json({ ok: false, error: "Method not allowed." }, { status: 405 });
}

async function handleBooked(req, env) {
  if (!env.SCHEDULING) return json({ ok: false, error: "SCHEDULING binding is not configured." }, { status: 500 });

  const url = new URL(req.url);
  const isoDate = String(url.searchParams.get("date") || "").trim();
  if (!isIsoDate(isoDate)) {
    return json({ ok: false, error: "Missing or invalid date (YYYY-MM-DD)." }, { status: 400 });
  }

  const bookedTimes = await getBookedTimesWithOverrides(env, isoDate);
  return json({ ok: true, date: isoDate, bookedTimes }, { status: 200 });
}

async function handleReserve(req, env) {
  if (!env.SCHEDULING) return json({ ok: false, error: "SCHEDULING binding is not configured." }, { status: 500 });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, { status: 405 });

  const body = await req.json().catch(() => null);
  const isoDate = String(body?.date || "").trim();
  const time = String(body?.time || "").trim();
  if (!isIsoDate(isoDate) || !isTimeHHMM(time)) {
    return json({ ok: false, error: "Invalid reservation payload." }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const clientFirstName = clampStr(body?.firstName, 50) || null;
  const clientLastName = clampStr(body?.lastName, 50) || null;
  const clientPhone = clampStr(body?.phone, 30) || null;
  const clientEmail = clampStr(body?.email, 120) || null;
  const notes = clampStr(body?.notes, 400) || null;

  try {
    const info = await env.SCHEDULING.prepare(
      `INSERT INTO appointment_reservations
       (isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes)
      .run();
    const id = Number(info?.meta?.last_row_id ?? 0);

    // Best-effort: create a Google Calendar event. Reservation should still succeed even if Calendar fails.
    let googleEventId = null;
    let googleEventLink = null;
    const gcal = await createGoogleCalendarEventForReservation(env, {
      id,
      isoDate,
      time,
      clientFirstName,
      clientLastName,
      clientPhone,
      clientEmail,
      notes,
    });
    if (gcal.ok) {
      googleEventId = gcal.eventId || null;
      googleEventLink = gcal.htmlLink || null;
      try {
        await env.SCHEDULING.prepare(
          `UPDATE appointment_reservations
           SET googleEventId = ?, googleEventLink = ?
           WHERE id = ?`,
        )
          .bind(googleEventId, googleEventLink, id)
          .run();
      } catch (e) {
        console.error("Failed to persist Google Calendar event metadata:", e);
      }
    } else {
      console.error("Google Calendar event creation failed (reservation still saved):", gcal.error);
    }

    return json(
      { ok: true, reservation: { id, isoDate, time, createdAt, googleEventId, googleEventLink } },
      { status: 201 },
    );
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return json({ ok: false, error: "That time slot has already been booked. Please pick another time." }, { status: 409 });
    }
    throw e;
  }
}

async function handleAdminLogin(req, env) {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, { status: 405 });
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ ok: false, error: "Admin auth secrets are not configured." }, { status: 500 });
  }
  const body = await req.json().catch(() => null);
  const password = String(body?.password || "");
  if (!password || password !== String(env.ADMIN_PASSWORD)) {
    return json({ ok: false, error: "Invalid credentials." }, { status: 401 });
  }
  const token = await issueAdminToken(env);
  return json({ ok: true, token, expiresInMs: ADMIN_TOKEN_TTL_MS }, { status: 200 });
}

async function handleAdminAppointments(req, env) {
  const auth = await requireAdmin(req, env);
  if (!auth.ok) return auth.response;
  if (!env.SCHEDULING) return json({ ok: false, error: "SCHEDULING binding is not configured." }, { status: 500 });

  if (req.method === "GET") {
    const url = new URL(req.url);
    const isoDate = String(url.searchParams.get("date") || "").trim();
    if (!isIsoDate(isoDate)) {
      return json({ ok: false, error: "Missing or invalid date (YYYY-MM-DD)." }, { status: 400 });
    }
    const [{ results: reservations }, { results: overrides }] = await Promise.all([
      env.SCHEDULING.prepare(
        `SELECT id, isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes
         FROM appointment_reservations
         WHERE isoDate = ?
         ORDER BY isoDate ASC, time ASC, id ASC`,
      )
        .bind(isoDate)
        .all(),
      env.SCHEDULING.prepare(
        `SELECT id, isoDate, time, isAvailable, note, createdAt
         FROM appointment_availability_overrides
         WHERE isoDate = ?
         ORDER BY isoDate ASC, time ASC, id ASC`,
      )
        .bind(isoDate)
        .all(),
    ]);
    return json(
      {
        ok: true,
        date: isoDate,
        reservations: reservations || [],
        overrides: (overrides || []).map((o) => ({ ...o, isAvailable: Number(o.isAvailable) === 1 })),
        effectiveBookedTimes: await getBookedTimesWithOverrides(env, isoDate),
      },
      { status: 200 },
    );
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    const isoDate = String(body?.date || "").trim();
    const time = String(body?.time || "").trim();
    if (!isIsoDate(isoDate) || !isTimeHHMM(time)) {
      return json({ ok: false, error: "Invalid appointment payload." }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const clientFirstName = clampStr(body?.firstName, 50) || null;
    const clientLastName = clampStr(body?.lastName, 50) || null;
    const clientPhone = clampStr(body?.phone, 30) || null;
    const clientEmail = clampStr(body?.email, 120) || null;
    const notes = clampStr(body?.notes, 400) || null;
    try {
      const info = await env.SCHEDULING.prepare(
        `INSERT INTO appointment_reservations
         (isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes)
        .run();
      const id = Number(info?.meta?.last_row_id ?? 0);
      return json({ ok: true, appointment: { id, isoDate, time, createdAt } }, { status: 201 });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        return json({ ok: false, error: "That time slot is already reserved." }, { status: 409 });
      }
      throw e;
    }
  }

  return json({ ok: false, error: "Method not allowed." }, { status: 405 });
}

async function handleAdminCancel(req, env, id) {
  const auth = await requireAdmin(req, env);
  if (!auth.ok) return auth.response;
  if (!env.SCHEDULING) return json({ ok: false, error: "SCHEDULING binding is not configured." }, { status: 500 });
  if (req.method !== "DELETE") return json({ ok: false, error: "Method not allowed." }, { status: 405 });
  const apptId = Number(id);
  if (!Number.isInteger(apptId) || apptId <= 0) {
    return json({ ok: false, error: "Invalid appointment id." }, { status: 400 });
  }
  const info = await env.SCHEDULING.prepare(`DELETE FROM appointment_reservations WHERE id = ?`).bind(apptId).run();
  if (!Number(info?.meta?.changes || 0)) {
    return json({ ok: false, error: "Appointment not found." }, { status: 404 });
  }
  return json({ ok: true, deletedId: apptId }, { status: 200 });
}

async function handleAdminAvailability(req, env) {
  const auth = await requireAdmin(req, env);
  if (!auth.ok) return auth.response;
  if (!env.SCHEDULING) return json({ ok: false, error: "SCHEDULING binding is not configured." }, { status: 500 });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, { status: 405 });

  const body = await req.json().catch(() => null);
  const isoDate = String(body?.date || "").trim();
  const time = String(body?.time || "").trim();
  const isAvailable = body?.isAvailable === true || body?.isAvailable === 1;
  const note = clampStr(body?.note, 200) || null;
  if (!isIsoDate(isoDate) || !isTimeHHMM(time)) {
    return json({ ok: false, error: "Invalid availability payload." }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  await env.SCHEDULING.prepare(
    `INSERT INTO appointment_availability_overrides (isoDate, time, isAvailable, note, createdAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(isoDate, time) DO UPDATE SET
       isAvailable = excluded.isAvailable,
       note = excluded.note,
       createdAt = excluded.createdAt`,
  )
    .bind(isoDate, time, isAvailable ? 1 : 0, note, createdAt)
    .run();

  return json({ ok: true, override: { isoDate, time, isAvailable, note, createdAt } }, { status: 200 });
}

async function handleAdminDeleteReview(req, env, id) {
  const auth = await requireAdmin(req, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json({ ok: false, error: "DB binding is not configured." }, { status: 500 });
  if (req.method !== "DELETE") return json({ ok: false, error: "Method not allowed." }, { status: 405 });

  const reviewId = Number(id);
  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    return json({ ok: false, error: "Invalid review id." }, { status: 400 });
  }

  const info = await env.DB.prepare(`DELETE FROM reviews WHERE id = ?`).bind(reviewId).run();
  if (!Number(info?.meta?.changes || 0)) {
    return json({ ok: false, error: "Review not found." }, { status: 404 });
  }
  return json({ ok: true, deletedId: reviewId }, { status: 200 });
}

export default {
  async fetch(req, env) {
    try {
      if (req.method === "OPTIONS") {
        return withCors(req, new Response(null, { status: 204 }));
      }

      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");
      const cancelMatch = /^\/api\/admin\/appointments\/(\d+)$/.exec(path);
      const deleteReviewMatch = /^\/api\/admin\/reviews\/(\d+)$/.exec(path);

      let res;
      if (path === "/api/reviews") res = await handleReviews(req, env);
      else if (path === "/api/appointments/booked" && req.method === "GET") res = await handleBooked(req, env);
      else if (path === "/api/appointments/reserve") res = await handleReserve(req, env);
      else if (path === "/api/admin/login") res = await handleAdminLogin(req, env);
      else if (path === "/api/admin/appointments") res = await handleAdminAppointments(req, env);
      else if (cancelMatch) res = await handleAdminCancel(req, env, cancelMatch[1]);
      else if (path === "/api/admin/availability") res = await handleAdminAvailability(req, env);
      else if (deleteReviewMatch) res = await handleAdminDeleteReview(req, env, deleteReviewMatch[1]);
      else res = json({ ok: false, error: "Not found." }, { status: 404 });

      return withCors(req, res);
    } catch (err) {
      console.error("Worker API error:", err);
      return withCors(req, json({ ok: false, error: "Server error." }, { status: 500 }));
    }
  },
};

