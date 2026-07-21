// ==UserScript==
// @name         Science Tokyo LMS 課題同期
// @namespace    https://lms.s.isct.ac.jp/
// @version      0.2.0
// @description  Moodleの課題期限を自分のDiscord Bot用APIへ同期します
// @match        https://lms.s.isct.ac.jp/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      REPLACE_WITH_WORKER_HOST
// ==/UserScript==

(() => {
  "use strict";

  // 必ず自分の環境に合わせて変更する。
  const API_BASE = "https://REPLACE_WITH_WORKER_DOMAIN";
  const SYNC_TOKEN = "REPLACE_WITH_SYNC_TOKEN";
  const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const ONE_DAY = 24 * 60 * 60;
  const MAX_EVENTS = 50;

  const LAST_SYNC_KEY = "scienceTokyoLmsLastSync";

  function getSource() {
    const year = location.pathname.match(/^\/(\d{4})(?:\/|$)/)?.[1];
    if (!year) throw new Error("LMSの年度URL（/YYYY/）ではないため同期しません。");
    return `science-tokyo-lms-${year}`;
  }

  function loadMoodleAjax() {
    return new Promise((resolve, reject) => {
      const requireFn = unsafeWindow.require;
      if (typeof requireFn !== "function") {
        reject(new Error("Moodleのrequire関数が見つかりません。LMS内のページで実行してください。"));
        return;
      }
      requireFn(["core/ajax"], resolve, reject);
    });
  }

  function normalizeUrl(rawUrl) {
    if (typeof rawUrl === "string") return rawUrl;
    if (typeof rawUrl?.url === "string") return rawUrl.url;
    return "";
  }

  async function fetchAssignments() {
    const Ajax = await loadMoodleAjax();
    const now = Math.floor(Date.now() / 1000);

    const result = await Ajax.call([
      {
        methodname: "core_calendar_get_action_events_by_timesort",
        args: {
          timesortfrom: now - 30 * ONE_DAY,
          timesortto: now + 365 * ONE_DAY,
          aftereventid: 0,
          limitnum: MAX_EVENTS,
        },
      },
    ])[0];

    const source = getSource();
    const events = result.events ?? [];

    const assignments = events
      .map((event) => {
        const url = normalizeUrl(
          event.url ?? event.action?.url ?? event.viewurl ?? "",
        );
        if (!url || !event.timesort) return null;

        let courseModuleId = null;
        try {
          courseModuleId = Number(
            new URL(url, location.origin).searchParams.get("id"),
          ) || null;
        } catch {
          // URLが解析できない場合もイベントIDで管理できる。
        }

        const course =
          event.course?.fullname ?? event.course?.shortname ?? "科目名不明";
        const title = event.activityname ?? event.name ?? "課題名不明";
        const deadlineUnix = Number(event.timesort);
        const deadlineDate = new Date(deadlineUnix * 1000);

        return {
          source,
          eventId: Number(event.id),
          courseModuleId,
          course,
          courseJa: course.split(" / ")[0].trim(),
          title,
          deadlineUnix,
          deadlineIso: deadlineDate.toISOString(),
          deadlineJst: deadlineDate.toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
          }),
          module: event.modulename ?? "",
          url,
          overdue: Boolean(event.overdue),
          syncedAt: new Date().toISOString(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.deadlineUnix - b.deadlineUnix);

    return {
      source,
      // 50件ちょうどの場合は取りこぼしの可能性があるため、既存データを無効化しない。
      complete: events.length < MAX_EVENTS,
      assignments,
    };
  }

  function postJson(path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${API_BASE}${path}`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SYNC_TOKEN}`,
        },
        data: JSON.stringify(body),
        timeout: 20_000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(
              new Error(
                `APIエラー ${response.status}: ${response.responseText}`,
              ),
            );
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch {
            resolve(response.responseText);
          }
        },
        onerror: () => reject(new Error("同期APIに接続できませんでした。")),
        ontimeout: () => reject(new Error("同期APIへの接続がタイムアウトしました。")),
      });
    });
  }

  async function syncNow({ notify = true } = {}) {
    setButtonState("syncing", "同期中…");

    try {
      if (API_BASE.includes("REPLACE_WITH_") || SYNC_TOKEN.includes("REPLACE_WITH_")) {
        throw new Error("API_BASEとSYNC_TOKENをTampermonkey上で設定してください。");
      }
      const payload = await fetchAssignments();
      const response = await postJson("/api/v1/assignments/sync", payload);
      const now = Date.now();
      GM_setValue(LAST_SYNC_KEY, now);

      console.table(payload.assignments);
      console.log("同期結果:", response);
      setButtonState("success", `${payload.assignments.length}件 同期済み`);

      if (notify) {
        alert(`${payload.assignments.length}件の課題を同期しました。`);
      }
    } catch (error) {
      console.error("LMS課題同期に失敗しました:", error);
      setButtonState("error", "同期失敗");

      if (notify) {
        alert(`課題の同期に失敗しました。\n${error.message ?? error}`);
      }
    }
  }

  let syncButton = null;

  function setButtonState(state, text) {
    if (!syncButton) return;
    syncButton.textContent = text;
    syncButton.dataset.state = state;
    syncButton.disabled = state === "syncing";
  }

  function shouldShowSyncButton() {
    return /^\/2025\/(?:course|my)(?:\/|$)/.test(location.pathname);
  }

  function addSyncButton() {
    if (!shouldShowSyncButton()) return;

    syncButton = document.createElement("button");
    syncButton.type = "button";
    syncButton.textContent = "Discordに同期";
    syncButton.title = "Moodleの課題名・期限・リンクだけを同期します";
    syncButton.style.cssText = [
      "position:fixed",
      "right:20px",
      "top:90px",
      "z-index:99999",
      "padding:10px 16px",
      "border:0",
      "border-radius:8px",
      "background:#1f6feb",
      "color:white",
      "font-weight:700",
      "box-shadow:0 2px 10px rgba(0,0,0,.25)",
      "cursor:pointer",
    ].join(";");
    syncButton.addEventListener("click", () => void syncNow());
    document.body.appendChild(syncButton);
  }

  function maybeAutoSync() {
    const lastSync = Number(GM_getValue(LAST_SYNC_KEY, 0));
    if (Date.now() - lastSync >= AUTO_SYNC_INTERVAL_MS) {
      setTimeout(() => void syncNow({ notify: false }), 3_000);
    }
  }

  GM_registerMenuCommand("課題を今すぐ同期", () => void syncNow());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      addSyncButton();
      maybeAutoSync();
    });
  } else {
    addSyncButton();
    maybeAutoSync();
  }
})();
