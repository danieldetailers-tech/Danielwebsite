import { clampStr, json } from "../_utils.js";

export async function onRequestGet(context) {
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT id, firstName, lastName, rating, comment, createdAt
       FROM reviews
       ORDER BY datetime(createdAt) ASC, id ASC`,
    ).all();

    return json({ ok: true, reviews: results || [] }, { status: 200 });
  } catch (err) {
    console.error("GET /api/reviews failed:", err);
    return json({ ok: false, error: "Failed to load reviews." }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => null);

    const firstName = clampStr(body?.firstName, 50);
    const lastName = clampStr(body?.lastName, 50);
    const rating = Number(body?.rating);
    const comment = clampStr(body?.comment, 800);

    if (!firstName || !lastName || !Number.isFinite(rating) || rating < 1 || rating > 5 || !comment) {
      return json({ ok: false, error: "Invalid review." }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const info = await context.env.DB.prepare(
      `INSERT INTO reviews (firstName, lastName, rating, comment, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(firstName, lastName, rating, comment, createdAt)
      .run();

    const id = Number(info?.meta?.last_row_id ?? 0);
    return json(
      { ok: true, review: { id, firstName, lastName, rating, comment, createdAt } },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/reviews failed:", err);
    return json({ ok: false, error: "Failed to save review." }, { status: 500 });
  }
}

