function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function withCors(req, res, { allowOrigin } = {}) {
  const origin = req.headers.get("Origin");
  const headers = new Headers(res.headers);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");

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

  const { results } = await env.SCHEDULING.prepare(
    `SELECT time FROM appointment_reservations WHERE isoDate = ? ORDER BY time ASC, id ASC`,
  )
    .bind(isoDate)
    .all();

  const bookedTimes = (results || []).map((r) => r.time).filter(Boolean);
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
    return json({ ok: true, reservation: { id, isoDate, time, createdAt } }, { status: 201 });
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return json({ ok: false, error: "That time slot has already been booked. Please pick another time." }, { status: 409 });
    }
    throw e;
  }
}

export default {
  async fetch(req, env) {
    try {
      if (req.method === "OPTIONS") {
        return withCors(req, new Response(null, { status: 204 }));
      }

      const url = new URL(req.url);
      const path = url.pathname.replace(/\/+$/, "");

      let res;
      if (path === "/api/reviews") res = await handleReviews(req, env);
      else if (path === "/api/appointments/booked" && req.method === "GET") res = await handleBooked(req, env);
      else if (path === "/api/appointments/reserve") res = await handleReserve(req, env);
      else res = json({ ok: false, error: "Not found." }, { status: 404 });

      return withCors(req, res);
    } catch (err) {
      console.error("Worker API error:", err);
      return withCors(req, json({ ok: false, error: "Server error." }, { status: 500 }));
    }
  },
};

