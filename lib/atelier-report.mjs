import { verifyMessage } from "viem";
import { parseGitHubIssueUrl } from "./evaluate-github-bounty.mjs";

const MAX_LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;

export class AtelierReportAccessError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AtelierReportAccessError";
    this.status = status;
  }
}

export function atelierReportMessage({ orderId, url, expires }) {
  const target = parseGitHubIssueUrl(url);
  if (!/^ord_[A-Za-z0-9_-]{6,120}$/.test(String(orderId ?? ""))) {
    throw new AtelierReportAccessError("order_id is invalid", 400);
  }
  const expiry = Number(expires);
  if (!Number.isSafeInteger(expiry)) {
    throw new AtelierReportAccessError("expires is invalid", 400);
  }
  return {
    target,
    orderId: String(orderId),
    expires: expiry,
    message: [
      "ArgonautWorks Atelier bounty report",
      `order:${orderId}`,
      `url:${target.canonicalUrl}`,
      `expires:${expiry}`,
    ].join("\n"),
  };
}

export async function authorizeAtelierReport(query, expectedAddress, options = {}) {
  const now = options.now?.getTime?.() ?? Date.now();
  const normalized = atelierReportMessage({
    orderId: query.order_id,
    url: query.url,
    expires: query.expires,
  });
  if (normalized.expires < now) {
    throw new AtelierReportAccessError("report link has expired", 410);
  }
  if (normalized.expires > now + MAX_LINK_LIFETIME_MS) {
    throw new AtelierReportAccessError("report link lifetime is too long", 400);
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(query.signature ?? ""))) {
    throw new AtelierReportAccessError("signature is invalid", 403);
  }
  const valid = await verifyMessage({
    address: expectedAddress,
    message: normalized.message,
    signature: query.signature,
  }).catch(() => false);
  if (!valid) throw new AtelierReportAccessError("signature is invalid", 403);
  return normalized;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function humanize(value) {
  return String(value).replaceAll("_", " ");
}

function evidenceValue(value) {
  if (value === null || value === undefined) return "not available";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function renderAtelierReport(result, orderId) {
  const reasons = result.reasons.length > 0
    ? result.reasons.map((reason) => `<li>${escapeHtml(humanize(reason))}</li>`).join("")
    : "<li>No automatic rejection signals found.</li>";
  const evidence = Object.entries({ reward_usd: result.reward_usd, ...result.evidence })
    .map(([key, value]) => `<tr><th>${escapeHtml(humanize(key))}</th><td>${escapeHtml(evidenceValue(value))}</td></tr>`)
    .join("");
  const verdictClass = ["viable", "caution", "reject"].includes(result.verdict)
    ? result.verdict
    : "caution";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>GitHub Bounty Reality Check</title>
  <style>
    :root{color-scheme:dark}body{margin:0;background:#0d0f12;color:#e8eaed;font:16px/1.55 system-ui,sans-serif}main{max-width:820px;margin:auto;padding:48px 24px 80px}h1{font-size:2rem;margin:0 0 8px}.muted{color:#9ba3ad}.score{display:flex;gap:16px;align-items:center;margin:28px 0;padding:22px;border:1px solid #2a3038;border-radius:14px;background:#15191e}.badge{font-weight:800;text-transform:uppercase;padding:7px 11px;border-radius:999px}.viable{background:#153f2d;color:#7ce2ae}.caution{background:#493b13;color:#f2ce67}.reject{background:#4d2024;color:#ff9da5}.number{font-size:2rem;font-weight:800}section{margin-top:32px}a{color:#8ab4f8;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;border-bottom:1px solid #292f36;text-align:left;vertical-align:top}th{width:48%;color:#aeb6c0;font-weight:600}footer{margin-top:40px;padding-top:18px;border-top:1px solid #292f36;color:#8b949e;font-size:.86rem}
  </style>
</head>
<body><main>
  <p class="muted">ArgonautWorks · paid Atelier order ${escapeHtml(orderId)}</p>
  <h1>GitHub Bounty Reality Check</h1>
  <p><a href="${escapeHtml(result.target.canonicalUrl)}">${escapeHtml(result.target.canonicalUrl)}</a></p>
  <div class="score"><span class="badge ${verdictClass}">${escapeHtml(result.verdict)}</span><span class="number">${escapeHtml(result.score)}/100</span></div>
  <section><h2>Why</h2><ul>${reasons}</ul></section>
  <section><h2>Evidence</h2><table>${evidence}</table></section>
  <section><h2>Recommendation</h2><p>${escapeHtml(result.recommendation)}</p></section>
  <footer>Checked ${escapeHtml(result.checked_at)}. This automated screen reduces wasted implementation time; verify sponsor ownership and exact payout terms before committing work.</footer>
</main></body></html>`;
}
