import { clampStr, isIsoDate, isTimeHHMM, json } from "../../_utils";

function isUniqueConstraintError(err) {
  const msg = String(err?.message || "");
  // D1 currently returns "D1_ERROR: UNIQUE constraint failed: ..." style messages.
  return msg.toLowerCase().includes("unique constraint failed");
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => null);

    const isoDate = String(body?.date || "").trim();
    const time = String(body?.time || "").trim();

    if (!isIsoDate(isoDate) || !isTimeHHMM(time)) {
      return json({ ok: false, error: "Invalid reservation payload." }, { status: 400 });
    }

    const createdAt = new Date().toISOString();
    const clientFirstName = clampStr(body?.firstName, 50);
    const clientLastName = clampStr(body?.lastName, 50);
    const clientPhone = clampStr(body?.phone, 30);
    const clientEmail = clampStr(body?.email, 120);
    const notes = clampStr(body?.notes, 400);

    try {
      const info = await context.env.DB.prepare(
        `INSERT INTO appointment_reservations
         (isoDate, time, createdAt, clientFirstName, clientLastName, clientPhone, clientEmail, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          isoDate,
          time,
          createdAt,
          clientFirstName || null,
          clientLastName || null,
          clientPhone || null,
          clientEmail || null,
          notes || null,
        )
        .run();

      const id = Number(info?.meta?.last_row_id ?? 0);
      return json({ ok: true, reservation: { id, isoDate, time, createdAt } }, { status: 201 });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        return json({ ok: false, error: "That time slot has already been booked. Please pick another time." }, { status: 409 });
      }
      throw e;
    }
  } catch (err) {
    console.error("POST /api/appointments/reserve failed:", err);
    return json({ ok: false, error: "Failed to reserve appointment slot." }, { status: 500 });
  }
}

