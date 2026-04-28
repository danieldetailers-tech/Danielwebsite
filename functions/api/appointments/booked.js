import { isIsoDate, json } from "../../_utils.js";

export async function onRequestGet(context) {
  try {
    if (!context?.env?.SCHEDULING) {
      return json({ ok: false, error: "Scheduling database binding (SCHEDULING) is not configured." }, { status: 500 });
    }

    const url = new URL(context.request.url);
    const isoDate = String(url.searchParams.get("date") || "").trim();

    if (!isIsoDate(isoDate)) {
      return json({ ok: false, error: "Missing or invalid date (YYYY-MM-DD)." }, { status: 400 });
    }

    const { results } = await context.env.SCHEDULING.prepare(
      `SELECT time FROM appointment_reservations WHERE isoDate = ? ORDER BY time ASC, id ASC`,
    )
      .bind(isoDate)
      .all();

    const bookedTimes = (results || []).map((r) => r.time).filter(Boolean);
    return json({ ok: true, date: isoDate, bookedTimes }, { status: 200 });
  } catch (err) {
    console.error("GET /api/appointments/booked failed:", err);
    return json({ ok: false, error: "Failed to load booked appointments." }, { status: 500 });
  }
}

