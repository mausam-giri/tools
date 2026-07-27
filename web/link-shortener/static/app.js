(() => {
  "use strict";

  const ANON_KEY = "mg_ls_anon";
  const ANON_COOKIE = "mg_ls_anon";

  const form = document.getElementById("form");
  const urlInput = document.getElementById("url");
  const presetSelect = document.getElementById("preset");
  const customBox = document.getElementById("custom-ttl");
  const days = document.getElementById("days");
  const hours = document.getElementById("hours");
  const mins = document.getElementById("mins");
  const submit = document.getElementById("submit");
  const errorEl = document.getElementById("error");
  const result = document.getElementById("result");
  const shortURL = document.getElementById("short-url");
  const meta = document.getElementById("meta");
  const open = document.getElementById("open");
  const copyBtn = document.getElementById("copy");
  const savedList = document.getElementById("saved-list");
  const savedEmpty = document.getElementById("saved-empty");
  const quota = document.getElementById("quota");
  const refreshSaved = document.getElementById("refresh-saved");

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function setCookie(name, value) {
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; Path=/; Max-Age=31536000; SameSite=Lax";
  }

  function newAnonId() {
    if (crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getAnonId() {
    let id = localStorage.getItem(ANON_KEY) || getCookie(ANON_COOKIE);
    if (!id || id.length < 16) {
      id = newAnonId();
    }
    localStorage.setItem(ANON_KEY, id);
    setCookie(ANON_COOKIE, id);
    return id;
  }

  const anonId = getAnonId();

  function authHeaders(extra = {}) {
    return {
      ...extra,
      "X-Anon-Id": anonId,
    };
  }

  function selectedPreset() {
    return presetSelect.value || "3d";
  }

  function syncCustom() {
    customBox.hidden = selectedPreset() !== "custom";
  }

  presetSelect.addEventListener("change", syncCustom);
  syncCustom();

  function showError(msg) {
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function formatExpiry(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function formatTTL(seconds) {
    const s = Number(seconds) || 0;
    const day = Math.floor(s / 86400);
    const hr = Math.floor((s % 86400) / 3600);
    const min = Math.floor((s % 3600) / 60);
    const parts = [];
    if (day) parts.push(`${day}d`);
    if (hr) parts.push(`${hr}h`);
    if (min || !parts.length) parts.push(`${min}m`);
    return parts.join(" ");
  }

  function setQuota(used, limit) {
    quota.textContent = `${used} / ${limit}`;
    submit.disabled = used >= limit;
    if (used >= limit) {
      submit.title = "Delete a link or wait for expiry (max 10)";
    } else {
      submit.title = "";
      submit.disabled = false;
    }
  }

  function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  async function loadMine() {
    try {
      const res = await fetch("/api/shorten/mine", {
        headers: authHeaders(),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load links");

      setQuota(data.used || 0, data.limit || 10);
      const links = data.links || [];
      savedList.innerHTML = "";
      savedEmpty.hidden = links.length > 0;

      links.forEach((link) => {
        const li = document.createElement("li");
        li.className = "saved-item";
        li.innerHTML = `
          <div class="saved-main">
            <a class="saved-short" href="${link.short_url}" target="_blank" rel="noopener">${link.short_url}</a>
            <p class="saved-long" title="${escapeAttr(link.url)}">${escapeHtml(truncate(link.url, 72))}</p>
            <p class="saved-exp">Expires ${formatExpiry(link.expires_at)}</p>
          </div>
          <div class="saved-actions">
            <button type="button" class="ghost copy-one" data-url="${escapeAttr(link.short_url)}">Copy</button>
            <button type="button" class="ghost danger delete-one" data-code="${escapeAttr(link.code)}">Delete</button>
          </div>
        `;
        savedList.appendChild(li);
      });
    } catch (err) {
      savedEmpty.hidden = false;
      savedEmpty.textContent = err.message || "Could not load saved links";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replaceAll("'", "&#39;");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    result.hidden = true;
    submit.disabled = true;

    const preset = selectedPreset();
    const body = {
      url: urlInput.value.trim(),
      preset,
      days: Number(days.value) || 0,
      hours: Number(hours.value) || 0,
      mins: Number(mins.value) || 0,
    };

    try {
      const res = await fetch("/api/shorten", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not shorten link");
      }

      shortURL.value = data.short_url;
      open.href = data.short_url;
      meta.textContent = `Expires ${formatExpiry(data.expires_at)} · lives ${formatTTL(data.ttl_seconds)} · ${data.used}/${data.limit} used`;
      result.hidden = false;
      shortURL.focus();
      shortURL.select();
      await loadMine();
    } catch (err) {
      showError(err.message || "Something went wrong");
      await loadMine();
    } finally {
      // loadMine may re-disable submit if at limit
    }
  });

  copyBtn.addEventListener("click", async () => {
    const value = shortURL.value;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1200);
    } catch {
      shortURL.select();
      document.execCommand("copy");
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1200);
    }
  });

  savedList.addEventListener("click", async (e) => {
    const copyOne = e.target.closest(".copy-one");
    if (copyOne) {
      const url = copyOne.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        copyOne.textContent = "Copied";
        setTimeout(() => {
          copyOne.textContent = "Copy";
        }, 1000);
      } catch {
        /* ignore */
      }
      return;
    }

    const del = e.target.closest(".delete-one");
    if (!del) return;
    const code = del.dataset.code;
    if (!code) return;
    del.disabled = true;
    try {
      const res = await fetch(`/api/shorten/${encodeURIComponent(code)}`, {
        method: "DELETE",
        headers: authHeaders(),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await loadMine();
    } catch (err) {
      showError(err.message || "Delete failed");
      del.disabled = false;
    }
  });

  refreshSaved.addEventListener("click", () => loadMine());
  loadMine();
})();
