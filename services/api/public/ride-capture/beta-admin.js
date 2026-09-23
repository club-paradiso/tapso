/**
 * Operator-only beta-tester invites and beta matcher progress, as a small panel
 * on the operator page. It reuses the operator token the page already holds in
 * sessionStorage and never writes it anywhere else. An invite link is shown
 * once, when it is created; the list never has it.
 */

import { DEFAULT_COLLECTOR_BASE } from "./background-client-core.js";
import { betaCampaignLines, inviteRowText } from "./beta-admin-core.js";

const TOKEN_KEY = "tapso.rideCapture.operatorToken";
const el = (id) => document.getElementById(id);

function operatorToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

async function call(path, { method = "GET", body } = {}) {
  const token = operatorToken();
  if (!token) throw new Error("먼저 위에서 운영자 잠금을 해제하세요.");
  let response;
  try {
    response = await fetch(`${DEFAULT_COLLECTOR_BASE}${path}`, {
      method,
      cache: "no-store",
      mode: "cors",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("수집 서버에 연결하지 못했습니다.");
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* status decides */ }
  if (!response.ok) {
    throw new Error(response.status === 401 ? "운영자 인증이 필요합니다." : payload.message || `요청 실패 (${response.status})`);
  }
  return payload;
}

function say(message, tone = "warn") {
  const node = el("beta-admin-alert");
  node.textContent = message;
  node.dataset.tone = tone;
}

async function refresh() {
  say("");
  try {
    const [{ invites }, campaign] = await Promise.all([call("/beta/invites"), call("/beta/campaign")]);
    const list = el("beta-invite-list");
    list.replaceChildren();
    for (const invite of invites) {
      const row = document.createElement("div");
      row.className = "history-row";
      const text = document.createElement("div");
      text.textContent = inviteRowText(invite, new Date());
      row.append(text);
      if (invite.status === "pending" || invite.status === "active") {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "ghost";
        revoke.textContent = "링크 폐기";
        revoke.addEventListener("click", () => void revokeInvite(invite));
        row.append(revoke);
      }
      list.append(row);
    }
    if (!invites.length) list.textContent = "아직 초대가 없습니다.";
    el("beta-campaign").textContent = betaCampaignLines(campaign).join("\n");
  } catch (error) {
    say(error.message, "bad");
  }
}

async function createInvite() {
  const label = el("beta-label").value.trim();
  el("beta-create").disabled = true;
  try {
    const created = await call("/beta/invites", { method: "POST", body: { label } });
    const url = created.inviteUrl || `${location.origin}${created.invitePath}`;
    el("beta-link").value = url;
    el("beta-link-block").hidden = false;
    el("beta-label").value = "";
    say("초대 링크는 지금 한 번만 보입니다. 복사해서 한 사람에게만 보내세요.", "ok");
    await refresh();
    say("초대 링크는 지금 한 번만 보입니다. 복사해서 한 사람에게만 보내세요.", "ok");
  } catch (error) {
    say(error.message, "bad");
  } finally {
    el("beta-create").disabled = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(el("beta-link").value);
    say("복사했습니다.", "ok");
  } catch {
    el("beta-link").select();
    say("길게 눌러 복사하세요.");
  }
}

async function revokeInvite(invite) {
  if (!window.confirm(`${invite.label || invite.inviteId} 링크를 폐기할까요? 되돌릴 수 없습니다.`)) return;
  try {
    await call(`/beta/invites/${encodeURIComponent(invite.inviteId)}/revoke`, { method: "POST", body: {} });
    await refresh();
  } catch (error) {
    say(error.message, "bad");
  }
}

el("beta-admin").addEventListener("toggle", () => {
  if (el("beta-admin").open) void refresh();
});
el("beta-create").addEventListener("click", () => void createInvite());
el("beta-copy").addEventListener("click", () => void copyLink());
el("beta-refresh").addEventListener("click", () => void refresh());
el("beta-link-hide").addEventListener("click", () => {
  el("beta-link").value = "";
  el("beta-link-block").hidden = true;
});
