{
  const $ = (sel) => document.querySelector(sel);
  const ADMIN_TOKEN_KEY = "dd_admin_token";
  const API_BASE = "https://daniels-detailers-api.danieldetailers.workers.dev";

  function apiUrl(path) {
    const base = String(API_BASE || "").trim().replace(/\/+$/, "");
    if (!base) return path;
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function getToken() {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
  }

  function setToken(token) {
    if (!token) {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      return;
    }
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  async function apiFetch(path, init = {}) {
    const token = getToken();
    const headers = new Headers(init.headers || {});
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const res = await fetch(apiUrl(path), { ...init, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof data?.error === "string" ? data.error : "Request failed.";
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function dashboardVisible(visible) {
    $("#admin-dashboard").classList.toggle("admin-hidden", !visible);
  }

  function setStatus(message) {
    $("#admin-status").textContent = message || "";
  }

  function renderAppointments(items) {
    const list = $("#admin-appointments-list");
    list.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = '<div class="review-card"><div class="review-text">No appointments for this date.</div></div>';
      return;
    }
    function formatTime12Hour(hhmm) {
      const [h, m] = String(hhmm || "").split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm || "");
      const d = new Date(2000, 0, 1, h, m, 0, 0);
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    }

    function formatDateMDY(isoDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
      if (!m) return String(isoDate || "");
      return `${m[2]}-${m[3]}-${m[1]}`;
    }

    items.forEach((a) => {
      const firstName = String(a.clientFirstName || "").trim();
      const lastName = String(a.clientLastName || "").trim();
      const customerName = [firstName, lastName].filter(Boolean).join(" ") || "N/A";
      const card = document.createElement("div");
      card.className = "review-card";
      card.innerHTML = `
        <div class="review-meta">
          <div class="review-name">${formatTime12Hour(a.time)} - ${customerName}</div>
          <button class="btn admin-cancel-btn" type="button" data-id="${a.id}">Cancel</button>
        </div>
        <div class="review-text">
          Date: ${formatDateMDY(a.isoDate)}<br/>
          Phone: ${a.clientPhone || "N/A"}
        </div>
      `;
      list.appendChild(card);
    });
  }

  function renderOverrides(items) {
    const list = $("#admin-overrides-list");
    list.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = '<div class="review-card"><div class="review-text">No slot overrides for this date.</div></div>';
      return;
    }
    items.forEach((o) => {
      const card = document.createElement("div");
      card.className = "review-card";
      card.innerHTML = `
        <div class="review-meta">
          <div class="review-name">${o.time}</div>
          <div class="review-rating">${o.isAvailable ? "FORCED OPEN" : "BLOCKED"}</div>
        </div>
        <div class="review-text">Note: ${o.note || "n/a"}</div>
      `;
      list.appendChild(card);
    });
  }

  async function loadSchedule() {
    const date = $("#admin-date").value;
    if (!date) {
      setStatus("Pick a date first.");
      return;
    }
    setStatus("Loading schedule...");
    try {
      const data = await apiFetch(`/api/admin/appointments?date=${encodeURIComponent(date)}`);
      renderAppointments(data.reservations || []);
      renderOverrides(data.overrides || []);
      setStatus(`Loaded ${date}.`);
    } catch (err) {
      if (err.status === 401) {
        setToken("");
        dashboardVisible(false);
      }
      setStatus(err.message || "Failed to load schedule.");
    }
  }

  function wireLogin() {
    const form = $("#admin-login-form");
    const status = $("#admin-login-status");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = $("#admin-password").value;
      status.textContent = "Logging in...";
      try {
        const data = await apiFetch("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        setToken(data.token || "");
        status.textContent = "Logged in.";
        dashboardVisible(true);
        await loadSchedule();
      } catch (err) {
        status.textContent = err.message || "Login failed.";
      }
    });
  }

  function wireAdminActions() {
    $("#admin-refresh-btn").addEventListener("click", loadSchedule);
    $("#admin-logout-btn").addEventListener("click", () => {
      setToken("");
      dashboardVisible(false);
      setStatus("Logged out.");
    });

    $("#admin-appointments-list").addEventListener("click", async (e) => {
      const btn = e.target.closest(".admin-cancel-btn");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      if (!id) return;
      setStatus("Canceling appointment...");
      try {
        await apiFetch(`/api/admin/appointments/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadSchedule();
        setStatus("Appointment canceled.");
      } catch (err) {
        setStatus(err.message || "Cancel failed.");
      }
    });

    $("#admin-add-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const date = $("#admin-date").value;
      if (!date) {
        setStatus("Pick a date before adding.");
        return;
      }
      const fd = new FormData(e.currentTarget);
      const payload = {
        date,
        time: String(fd.get("time") || ""),
        firstName: String(fd.get("firstName") || ""),
        lastName: String(fd.get("lastName") || ""),
        phone: String(fd.get("phone") || ""),
        email: String(fd.get("email") || ""),
        notes: String(fd.get("notes") || ""),
      };
      setStatus("Adding appointment...");
      try {
        await apiFetch("/api/admin/appointments", { method: "POST", body: JSON.stringify(payload) });
        e.currentTarget.reset();
        await loadSchedule();
        setStatus("Appointment added.");
      } catch (err) {
        setStatus(err.message || "Add failed.");
      }
    });

    $("#admin-override-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const date = $("#admin-date").value;
      if (!date) {
        setStatus("Pick a date before changing availability.");
        return;
      }
      const fd = new FormData(e.currentTarget);
      const mode = String(fd.get("mode") || "block");
      const payload = {
        date,
        time: String(fd.get("time") || ""),
        isAvailable: mode === "open",
        note: String(fd.get("note") || ""),
      };
      setStatus("Saving slot override...");
      try {
        await apiFetch("/api/admin/availability", { method: "POST", body: JSON.stringify(payload) });
        e.currentTarget.reset();
        await loadSchedule();
        setStatus("Slot override saved.");
      } catch (err) {
        setStatus(err.message || "Override failed.");
      }
    });
  }

  function init() {
    $("#admin-date").value = todayISO();
    wireLogin();
    wireAdminActions();
    if (getToken()) {
      dashboardVisible(true);
      loadSchedule();
    }
  }

  init();
}
