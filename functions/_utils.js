function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  // Helpful for local testing; safe for production.
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function clampStr(s, maxLen) {
  const v = String(s ?? "").trim();
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function isIsoDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? "").trim());
}

function isTimeHHMM(t) {
  return /^\d{2}:\d{2}$/.test(String(t ?? "").trim());
}

export { clampStr, isIsoDate, isTimeHHMM, json };

