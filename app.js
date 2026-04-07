const $ = (sel) => document.querySelector(sel);

function setActiveTab(tabName) {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === tabName);
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase();
}

// TODO: Paste the exact header row values from your `service log` sheet here.
// The scheduling form will be generated from these headers, excluding price/tip/total/review.
const SERVICE_LOG_HEADERS = [
  // Examples (replace with your real columns):
  "First Name",
  "Last Name",
  "Email",
  "Phone Number",
  "Address",
  "City",
  "State",
  "Zip Code",
  "Appointment Date",
  "Appointment Time",
  "Notes",
];

const EXCLUDED_HEADERS = new Set(["price", "tip", "total", "review"]);
const APPOINTMENT_EMAIL_TO = "Sanabria.da07@gmail.com";

// --- Automatic email sending (EmailJS) ---
// To enable: create an EmailJS account and fill in these three values.
// - EMAILJS_PUBLIC_KEY: Account public key
// - EMAILJS_SERVICE_ID: Email service ID
// - EMAILJS_TEMPLATE_ID: Template ID (set the template to send to APPOINTMENT_EMAIL_TO)
//
// The site will fall back to opening a pre-filled email draft if these are left blank.
const EMAILJS_PUBLIC_KEY = "Dp6h0K-jxOJ0fTY-t";
const EMAILJS_SERVICE_ID = "service_v5oirug";
const EMAILJS_TEMPLATE_ID = "template_ecnxxje";

function emailJsIsConfigured() {
  return Boolean(EMAILJS_PUBLIC_KEY && EMAILJS_SERVICE_ID && EMAILJS_TEMPLATE_ID && window.emailjs);
}

function initEmailJsIfConfigured() {
  if (!emailJsIsConfigured()) return;
  try {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  } catch {
    // If init fails, we will fall back to mailto behavior on submit.
  }
}

function buildAppointmentEmail(record) {
  const subject = "New Appointment Request — Daniel’s Detailers";
  const lines = Object.entries(record).map(([k, v]) => `${k}: ${v}`);
  const body =
    `New appointment request received.\n\n${lines.join("\n")}\n\nSubmitted at: ${new Date().toLocaleString()}\n\n` +
    "Note: Customers do not pay when scheduling; payment is due after service completion on the scheduled day.";
  return { subject, body };
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Mon–Fri: 1:00 PM–8:00 PM. Sat–Sun: 10:00 AM–6:00 PM (local date). */
const WEEKDAY_TIME = { min: "13:00", max: "20:00" };
const WEEKEND_TIME = { min: "10:00", max: "18:00" };

// Detail jobs typically take 2–4 hours. Use a conservative 4-hour block to prevent overlaps.
const APPOINTMENT_BLOCK_MINUTES = 60 * 4;

function parseISODateLocal(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getTimeWindowForISODate(iso) {
  const dt = parseISODateLocal(iso);
  if (!dt || Number.isNaN(dt.getTime())) return null;
  const dow = dt.getDay();
  const isWeekend = dow === 0 || dow === 6;
  return isWeekend ? WEEKEND_TIME : WEEKDAY_TIME;
}

function timeStringToMinutes(t) {
  const [h, m] = String(t || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function isTimeWithinWindow(timeVal, window) {
  if (!window || !timeVal) return false;
  const cur = timeStringToMinutes(timeVal);
  const lo = timeStringToMinutes(window.min);
  const hi = timeStringToMinutes(window.max);
  if (cur == null || lo == null || hi == null) return false;
  return cur >= lo && cur <= hi;
}

/** Match previous 15-minute slot behavior when using native time picker. */
function isQuarterHourTime(hhmm) {
  const mins = timeStringToMinutes(hhmm);
  return mins != null && mins % 15 === 0;
}

/** Every 15 minutes from min to max inclusive (expects "HH:MM" on quarter hours). */
function buildQuarterHourSlotStrings(minStr, maxStr) {
  const lo = timeStringToMinutes(minStr);
  const hi = timeStringToMinutes(maxStr);
  if (lo == null || hi == null || lo > hi) return [];
  const out = [];
  for (let m = lo; m <= hi; m += 15) {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    out.push(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return out;
}

function formatTimeSlotLabel(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm);
  const d = new Date(2000, 0, 1, h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function resetAppointmentTimeSelect(select) {
  select.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select a time";
  ph.disabled = true;
  ph.selected = true;
  select.appendChild(ph);
}

function loadAppointments() {
  try {
    const raw = localStorage.getItem("dd_appointments");
    const appts = raw ? JSON.parse(raw) : [];
    return Array.isArray(appts) ? appts : [];
  } catch {
    return [];
  }
}

function getRecordValue(record, header) {
  if (!record) return "";
  const direct = record[header];
  if (direct != null) return String(direct).trim();
  const target = normalizeHeader(header);
  const foundKey = Object.keys(record).find((k) => normalizeHeader(k) === target);
  return foundKey ? String(record[foundKey] ?? "").trim() : "";
}

function recordIsoDate(record) {
  return getRecordValue(record, "Appointment Date");
}

function recordTime(record) {
  return getRecordValue(record, "Appointment Time");
}

function timesOverlap(startA, durA, startB, durB) {
  const a0 = timeStringToMinutes(startA);
  const b0 = timeStringToMinutes(startB);
  if (a0 == null || b0 == null) return false;
  const a1 = a0 + durA;
  const b1 = b0 + durB;
  return a0 < b1 && b0 < a1;
}

function isSlotBlockedByExistingAppointments(isoDate, startTime, durationMins = APPOINTMENT_BLOCK_MINUTES) {
  if (!isoDate || !startTime) return false;
  const appts = loadAppointments();
  return appts.some((a) => {
    if (recordIsoDate(a) !== isoDate) return false;
    const t = recordTime(a);
    if (!t) return false;
    return timesOverlap(startTime, durationMins, t, APPOINTMENT_BLOCK_MINUTES);
  });
}

/** US phone: (XXX)XXX-XXXX as user types (max 10 digits). */
function formatUsPhoneMask(digitsOnly) {
  const d = String(digitsOnly || "").replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)})${d.slice(3)}`;
  return `(${d.slice(0, 3)})${d.slice(3, 6)}-${d.slice(6)}`;
}

function phoneUsDigitCount(value) {
  return String(value || "").replace(/\D/g, "").length;
}

function headerToInputType(header) {
  const h = normalizeHeader(header);

  // Calendar picker: native date input (browser shows month grid / calendar UI).
  if (
    /\bdate\b/.test(h) ||
    /appointment\s*day|preferred\s*day|schedule\s*day/.test(h) ||
    /^(day|appointment day)$/i.test(h.trim())
  ) {
    return "date";
  }
  if (/time/.test(h)) return "time";
  if (/email/.test(h)) return "email";
  if (/phone|mobile/.test(h)) return "tel";
  if (/notes|description|comment|details/.test(h)) return "textarea";
  return "text";
}

function formatLabel(header) {
  return String(header || "").trim() || "Field";
}

/** Email and notes-style fields are optional; phone is required for appointment requests. */
function isOptionalAppointmentFieldType(type) {
  return type === "email" || type === "textarea";
}

function buildSchedulingForm() {
  const fieldsWrap = $("#schedule-fields");
  fieldsWrap.innerHTML = "";

  const includedHeaders = SERVICE_LOG_HEADERS.filter((h) => {
    const nh = normalizeHeader(h);
    // Exclude exact matches (and allow some common variations).
    return ![...EXCLUDED_HEADERS].some((x) => nh === x || nh.replaceAll(" ", "") === x);
  });

  if (includedHeaders.length === 0) {
    fieldsWrap.innerHTML =
      '<div class="review-card" role="note">Add your `service log` headers in `app.js` to generate the scheduling fields.</div>';
    return;
  }

  // Two columns on desktop.
  includedHeaders.forEach((header) => {
    const type = headerToInputType(header);
    const field = document.createElement("label");
    field.className = "field";

    if (type === "textarea") field.classList.add("field-full");

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = isOptionalAppointmentFieldType(type)
      ? `${formatLabel(header)} (optional)`
      : formatLabel(header);
    field.appendChild(label);

    let input;
    if (type === "textarea") {
      input = document.createElement("textarea");
      input.rows = 3;
    } else if (type === "time") {
      // Native <input type="time"> often shows a minute-by-minute wheel; a <select>
      // lists only :00 / :15 / :30 / :45 so mobile pickers stay on 15-minute steps.
      input = document.createElement("select");
    } else {
      input = document.createElement("input");
      input.type = type;
    }

    input.required = !isOptionalAppointmentFieldType(type);
    input.dataset.col = header;

    if (type === "time") {
      input.dataset.appointmentTime = "true";
      input.title =
        "Choose a time from the list. Mon–Fri 1:00–8:00 PM; Sat–Sun 10:00 AM–6:00 PM.";
      input.disabled = true;
      resetAppointmentTimeSelect(input);
      const hint = document.createElement("span");
      hint.className = "field-hint";
      hint.dataset.timeWindow = "true";
      hint.textContent =
        "Select a date first, then choose a time. Mon–Fri 1:00–8:00 PM; Sat–Sun 10:00 AM–6:00 PM.";
      field.appendChild(input);
      field.appendChild(hint);
    } else if (type === "date") {
      input.min = todayLocalISO();
      input.title = "Open the calendar to choose your appointment day";
      input.setAttribute("aria-label", `${formatLabel(header)} — use the calendar to pick a day`);
      const hint = document.createElement("span");
      hint.className = "field-hint";
      hint.textContent = "Click the field or calendar icon to choose a day.";
      field.appendChild(input);
      field.appendChild(hint);
    } else if (type === "tel") {
      input.dataset.phoneUs = "true";
      input.className = "phone-us-input";
      input.inputMode = "numeric";
      input.autocomplete = "tel-national";
      input.placeholder = "(___)___-____";
      input.title = "10-digit U.S. phone number";
      input.maxLength = 13;
      field.appendChild(input);
    } else {
      field.appendChild(input);
    }

    fieldsWrap.appendChild(field);
  });
}

function syncAppointmentTimeWindow() {
  const form = $("#schedule-form");
  if (!form) return;
  const dateInput = form.querySelector('input[type="date"]');
  const timeInput = form.querySelector('[data-appointment-time="true"]');
  if (!timeInput) return;

  const hint = timeInput.closest(".field")?.querySelector(".field-hint[data-time-window]");
  const iso = dateInput?.value || "";

  if (dateInput && !iso) {
    resetAppointmentTimeSelect(timeInput);
    timeInput.disabled = true;
    if (hint) {
      hint.textContent =
        "Select a date first, then choose a time. Mon–Fri 1:00–8:00 PM; Sat–Sun 10:00 AM–6:00 PM.";
    }
    return;
  }

  const win = getTimeWindowForISODate(iso);
  if (!win) {
    resetAppointmentTimeSelect(timeInput);
    timeInput.disabled = true;
    if (hint) hint.textContent = "Choose a valid appointment date.";
    return;
  }

  const prev = timeInput.value;
  const slots = buildQuarterHourSlotStrings(win.min, win.max);
  timeInput.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select a time";
  ph.disabled = true;
  timeInput.appendChild(ph);
  for (const t of slots) {
    if (isSlotBlockedByExistingAppointments(iso, t)) continue;
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = formatTimeSlotLabel(t);
    timeInput.appendChild(opt);
  }
  timeInput.disabled = false;
  if (prev && slots.includes(prev) && !isSlotBlockedByExistingAppointments(iso, prev)) timeInput.value = prev;
  else timeInput.value = "";

  const dt = parseISODateLocal(iso);
  const weekend = dt && [0, 6].includes(dt.getDay());
  if (hint) {
    hint.textContent = weekend
      ? "Weekend: 10:00 AM – 6:00 PM, every 15 minutes."
      : "Weekday: 1:00 PM – 8:00 PM, every 15 minutes.";
  }
}

function wireAppointmentAvailability() {
  const form = $("#schedule-form");
  if (!form) return;
  const dateInput = form.querySelector('input[type="date"]');
  if (dateInput) {
    dateInput.addEventListener("change", syncAppointmentTimeWindow);
    dateInput.addEventListener("input", syncAppointmentTimeWindow);
  }
  syncAppointmentTimeWindow();
}

function wirePhoneMasks() {
  const form = $("#schedule-form");
  if (!form) return;
  form.querySelectorAll('input[data-phone-us="true"]').forEach((input) => {
    input.addEventListener("input", () => {
      const digits = input.value.replace(/\D/g, "").slice(0, 10);
      input.value = formatUsPhoneMask(digits);
      const len = input.value.length;
      input.setSelectionRange(len, len);
    });
  });
}

function loadReviews() {
  try {
    const raw = localStorage.getItem("dd_reviews");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveReviews(reviews) {
  localStorage.setItem("dd_reviews", JSON.stringify(reviews));
}

function renderReviews() {
  const list = $("#reviews-list");
  const reviews = loadReviews();
  list.innerHTML = "";

  if (reviews.length === 0) {
    list.innerHTML =
      '<div class="review-card"><div class="review-text">No reviews yet. Be the first to leave one.</div></div>';
    return;
  }

  reviews
    .slice()
    .reverse()
    .forEach((r) => {
      const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
      const card = document.createElement("div");
      card.className = "review-card";
      card.innerHTML = `
        <div class="review-meta">
          <div class="review-name">${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}</div>
          <div class="review-rating" aria-label="${r.rating} out of 5 stars">${stars}</div>
        </div>
        <div class="review-text">${escapeHtml(r.comment)}</div>
      `;
      list.appendChild(card);
    });
}

function loadYear() {
  const el = $("#year");
  if (el) el.textContent = new Date().getFullYear();
}

function wireTabs() {
  document.querySelectorAll(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
}

function wireSchedulingForm() {
  const form = $("#schedule-form");
  const status = $("#schedule-status");
  if (!form || !status) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const inputs = form.querySelectorAll("input[data-col], textarea[data-col], select[data-col]");

    if (inputs.length === 0) {
      status.textContent = "Scheduling fields aren’t set up yet.";
      return;
    }

    for (const phoneEl of form.querySelectorAll('input[data-phone-us="true"]')) {
      if (phoneUsDigitCount(phoneEl.value) !== 10) {
        status.textContent = "Please enter a complete 10-digit phone number like (555)555-1234.";
        phoneEl.focus();
        return;
      }
      phoneEl.value = formatUsPhoneMask(phoneEl.value.replace(/\D/g, ""));
    }

    const record = {};
    inputs.forEach((el) => {
      let val = (el.value || "").trim();
      if (el instanceof HTMLInputElement && el.dataset.phoneUs === "true" && val) {
        val = formatUsPhoneMask(val.replace(/\D/g, ""));
      }
      record[el.dataset.col] = val;
    });

    const dateInput = form.querySelector('input[type="date"]');
    const timeInput = form.querySelector('[data-appointment-time="true"]');
    if (timeInput && dateInput) {
      const win = getTimeWindowForISODate(dateInput.value);
      if (!dateInput.value) {
        status.textContent = "Please choose an appointment date.";
        return;
      }
      if (!win) {
        status.textContent = "Please choose a valid appointment date.";
        return;
      }
      if (
        !timeInput.value ||
        !isTimeWithinWindow(timeInput.value, win) ||
        !isQuarterHourTime(timeInput.value)
      ) {
        const dt = parseISODateLocal(dateInput.value);
        const isWeekend = dt && [0, 6].includes(dt.getDay());
        status.textContent = isWeekend
          ? "Please choose a time between 10:00 AM and 6:00 PM for weekends."
          : "Please choose a time between 1:00 PM and 8:00 PM on weekdays.";
        return;
      }

      // Prevent double-booking overlaps on the same day (based on locally saved appointments).
      if (isSlotBlockedByExistingAppointments(dateInput.value, timeInput.value)) {
        status.textContent =
          "That time is no longer available. Please pick a different time (appointments are spaced to avoid overlaps).";
        syncAppointmentTimeWindow();
        timeInput.focus();
        return;
      }
    }

    try {
      const appts = loadAppointments();
      appts.push({
        ...record,
        submittedAt: new Date().toISOString(),
      });
      localStorage.setItem("dd_appointments", JSON.stringify(appts));
    } catch {
      // If storage fails, still show a success message locally.
    }

    const { subject, body } = buildAppointmentEmail(record);

    // Preferred: send automatically via EmailJS if configured.
    if (emailJsIsConfigured()) {
      status.textContent = "Sending your request…";
      try {
        await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          to_email: APPOINTMENT_EMAIL_TO,
          subject,
          message: body,
          // Optional: also provide raw JSON to use in templates if desired
          appointment_json: JSON.stringify(record, null, 2),
        });
        status.textContent = "Request received! Your appointment was emailed successfully.";
        form.reset();
        syncAppointmentTimeWindow();
        return;
      } catch {
        // Fall back below.
      }
    }

    // Fallback: open an email draft in the user's email client.
    const mailto = `mailto:${encodeURIComponent(APPOINTMENT_EMAIL_TO)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
    status.textContent =
      "Request received! We couldn’t send automatically, so an email draft will open with your appointment details.";
    form.reset();
    syncAppointmentTimeWindow();
    window.location.href = mailto;
  });
}

function wireReviewForm() {
  const form = $("#review-form");
  const status = $("#review-status");
  if (!form || !status) return;

  // Keep stars in sync with the selected radio.
  function syncRatingUI() {
    const checked = form.querySelector('input[name="rating"]:checked');
    const rating = checked ? Number(checked.value) : 0;
    form.querySelectorAll(".rating-star").forEach((starLabel) => {
      const starValue = Number(String(starLabel.getAttribute("for") || "").replace("star-", ""));
      starLabel.classList.toggle("is-active", starValue <= rating);
    });
  }

  form.querySelectorAll('input[name="rating"]').forEach((input) => {
    input.addEventListener("change", syncRatingUI);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const fd = new FormData(form);
    const firstName = String(fd.get("firstName") || "").trim();
    const lastName = String(fd.get("lastName") || "").trim();
    const rating = Number(fd.get("rating"));
    const comment = String(fd.get("comment") || "").trim();

    if (!firstName || !lastName || !Number.isFinite(rating) || rating < 1 || rating > 5 || !comment) {
      status.textContent = "Please complete all review fields.";
      return;
    }

    const reviews = loadReviews();
    reviews.push({ firstName, lastName, rating, comment, createdAt: new Date().toISOString() });
    saveReviews(reviews);

    status.textContent = "Review posted. Thank you!";
    form.reset();
    renderReviews();
    syncRatingUI();
  });
}

function init() {
  loadYear();
  wireTabs();
  initEmailJsIfConfigured();
  buildSchedulingForm();
  wirePhoneMasks();
  wireAppointmentAvailability();
  wireSchedulingForm();
  renderReviews();
  wireReviewForm();

  // Initial star state (if a user navigates back and the browser restores values).
  const reviewForm = $("#review-form");
  if (reviewForm) {
    // Trigger the same sync logic used in the submit wire-up.
    const checked = reviewForm.querySelector('input[name="rating"]:checked');
    const rating = checked ? Number(checked.value) : 0;
    reviewForm.querySelectorAll(".rating-star").forEach((starLabel) => {
      const starValue = Number(String(starLabel.getAttribute("for") || "").replace("star-", ""));
      starLabel.classList.toggle("is-active", starValue <= rating);
    });
  }
}

init();

