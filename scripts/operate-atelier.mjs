import { privateKeyToAccount } from "viem/accounts";
import { atelierReportMessage } from "../lib/atelier-report.mjs";
import {
  atelierRequest,
  DEFAULT_ATELIER_STATE,
  DEFAULT_WALLET_STATE,
  extractGitHubIssueUrl,
  loadPrivateJson,
  writePrivateJson,
} from "../lib/atelier-operator.mjs";

const state = await loadPrivateJson(process.env.ATELIER_STATE_FILE ?? DEFAULT_ATELIER_STATE);
const operatorStatePath = process.env.ATELIER_OPERATOR_STATE
  ?? "/home/oak/.local/state/venture-lab/atelier-operator.json";
let operatorState;
try {
  operatorState = await loadPrivateJson(operatorStatePath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  operatorState = { schema_version: 1, input_requests: {} };
}
const wallet = await loadPrivateJson(process.env.ARGONAUT_WALLET_FILE ?? DEFAULT_WALLET_STATE);
const account = privateKeyToAccount(wallet.private_key);
if (account.address.toLowerCase() !== state.payout_wallet.toLowerCase()) {
  throw new Error("Atelier payout wallet does not match the signing wallet");
}

const ordersResult = await atelierRequest(
  state,
  `/api/agents/${encodeURIComponent(state.agent_id)}/orders?status=paid,in_progress,revision_requested`,
);
const orders = Array.isArray(ordersResult) ? ordersResult : ordersResult?.orders ?? [];
let delivered = 0;
let needsInput = 0;
let stateChanged = false;

for (const order of orders) {
  if (!order?.id || !["paid", "in_progress", "revision_requested"].includes(order.status)) continue;
  let targetUrl = extractGitHubIssueUrl(order);
  if (!targetUrl) {
    try {
      const messages = await atelierRequest(state, `/api/orders/${encodeURIComponent(order.id)}/messages`);
      targetUrl = extractGitHubIssueUrl({ brief: messages });
    } catch {
      // A required structured URL normally makes this fallback unnecessary.
    }
  }
  if (!targetUrl) {
    if (operatorState.input_requests[order.id]?.status !== order.status) {
      await atelierRequest(state, `/api/orders/${encodeURIComponent(order.id)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: "A canonical public GitHub issue URL is required (https://github.com/owner/repo/issues/123). Send it in this order chat and the report will be generated automatically.",
        }),
      });
      operatorState.input_requests[order.id] = { status: order.status, requested_at: new Date().toISOString() };
      stateChanged = true;
    }
    needsInput += 1;
    continue;
  }

  const expires = Date.now() + 30 * 24 * 60 * 60 * 1_000;
  const signed = atelierReportMessage({ orderId: order.id, url: targetUrl, expires });
  const signature = await account.signMessage({ message: signed.message });
  const deliverable = new URL("/api/v1/atelier-report", "https://argonaut-bounty-signal.vercel.app");
  deliverable.searchParams.set("order_id", order.id);
  deliverable.searchParams.set("url", signed.target.canonicalUrl);
  deliverable.searchParams.set("expires", String(expires));
  deliverable.searchParams.set("signature", signature);

  const validation = await fetch(deliverable, { signal: AbortSignal.timeout(30_000) });
  if (!validation.ok) throw new Error(`Generated report link failed validation (${validation.status})`);

  await atelierRequest(state, `/api/orders/${encodeURIComponent(order.id)}/deliver`, {
    method: "POST",
    body: JSON.stringify({
      deliverable_url: deliverable.href,
      deliverable_media_type: "link",
    }),
  });
  await atelierRequest(state, `/api/orders/${encodeURIComponent(order.id)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: "Your evidence-backed GitHub bounty reality check is ready. The signed report link remains available for 30 days.",
    }),
  });
  delivered += 1;
  if (operatorState.input_requests[order.id]) {
    delete operatorState.input_requests[order.id];
    stateChanged = true;
  }
}

if (stateChanged) {
  operatorState.updated_at = new Date().toISOString();
  await writePrivateJson(operatorStatePath, operatorState);
}
console.log(JSON.stringify({ checked_orders: orders.length, delivered, needs_input: needsInput }));
