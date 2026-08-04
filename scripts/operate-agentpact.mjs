import { privateKeyToAccount } from "viem/accounts";
import { agentPactReportMessage } from "../lib/atelier-report.mjs";
import {
  AgentPactMcpClient,
  DEFAULT_AGENTPACT_STATE,
  agentPactPublicGet,
  extractAgentPactIssueUrl,
  qualifyAgentPactDeal,
  verifyAgentPactFunding,
} from "../lib/agentpact-operator.mjs";
import {
  DEFAULT_WALLET_STATE,
  loadPrivateJson,
  writePrivateJson,
} from "../lib/atelier-operator.mjs";

const state = await loadPrivateJson(process.env.AGENTPACT_STATE_FILE ?? DEFAULT_AGENTPACT_STATE);
const wallet = await loadPrivateJson(process.env.ARGONAUT_WALLET_FILE ?? DEFAULT_WALLET_STATE);
const account = privateKeyToAccount(wallet.private_key);
if (account.address.toLowerCase() !== state.payout_wallet.toLowerCase()) {
  throw new Error("AgentPact payout wallet does not match the signing wallet");
}
const operatorPath = process.env.AGENTPACT_OPERATOR_STATE
  ?? "/home/oak/.local/state/venture-lab/agentpact-operator.json";
let operator;
try {
  operator = await loadPrivateJson(operatorPath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  operator = { schema_version: 1, accepted: {}, delivered: {}, rejected: {} };
}

const client = new AgentPactMcpClient();
const rawDeals = await agentPactPublicGet(`/deals?seller_agent_id=${encodeURIComponent(state.agent_id)}&limit=200`);
const listedDeals = (Array.isArray(rawDeals) ? rawDeals : rawDeals?.deals ?? rawDeals?.data ?? [])
  .filter((deal) => deal?.seller_agent_id === state.agent_id && deal?.offer_id === state.offer_id);
const rememberedDeals = await Promise.all(
  Object.keys(operator.accepted)
    .filter((id) => !operator.delivered[id] && !listedDeals.some((deal) => deal.id === id))
    .map((id) => agentPactPublicGet(`/deals/${encodeURIComponent(id)}`).catch(() => null)),
);
const deals = [...listedDeals, ...rememberedDeals]
  .filter((deal) => deal?.seller_agent_id === state.agent_id && deal?.offer_id === state.offer_id);
let accepted = 0;
let delivered = 0;
let waitingFunding = 0;
let stateChanged = false;

for (const deal of deals) {
  let need = {};
  if (deal.need_id) {
    need = await agentPactPublicGet(`/needs/${encodeURIComponent(deal.need_id)}`).catch(() => ({}));
  }

  if (deal.status === "proposed") {
    const verdict = qualifyAgentPactDeal(deal, need, state);
    if (!verdict.qualified) {
      const reason = verdict.reasons.join(",");
      if (operator.rejected[deal.id] !== reason) {
        operator.rejected[deal.id] = reason;
        stateChanged = true;
      }
      continue;
    }
    await client.call("agentpact.accept_deal", {
      dealId: deal.id,
      actorAgentId: state.agent_id,
      apiKey: state.api_key,
    });
    operator.accepted[deal.id] = { accepted_at: new Date().toISOString(), target_url: verdict.targetUrl };
    accepted += 1;
    stateChanged = true;
    continue;
  }

  if (deal.status !== "active" || operator.delivered[deal.id]) continue;
  const milestone = Array.isArray(deal.milestones) ? deal.milestones[0] : null;
  if (!milestone?.id) continue;
  const targetUrl = operator.accepted[deal.id]?.target_url ?? extractAgentPactIssueUrl(need, milestone);
  if (!targetUrl) continue;
  const payment = await client.call("agentpact.get_payment_status", {
    milestoneId: milestone.id,
    apiKey: state.api_key,
  });
  const funding = await verifyAgentPactFunding(payment, Number(milestone.amount));
  if (!funding.verified) {
    waitingFunding += 1;
    continue;
  }

  const expires = Date.now() + 30 * 24 * 60 * 60 * 1_000;
  const signed = agentPactReportMessage({ dealId: deal.id, url: targetUrl, expires });
  const signature = await account.signMessage({ message: signed.message });
  const deliverable = new URL("/api/v1/agentpact-report", "https://argonaut-bounty-signal.vercel.app");
  deliverable.searchParams.set("deal_id", deal.id);
  deliverable.searchParams.set("url", signed.target.canonicalUrl);
  deliverable.searchParams.set("expires", String(expires));
  deliverable.searchParams.set("signature", signature);
  const validation = await fetch(deliverable, { signal: AbortSignal.timeout(30_000) });
  if (!validation.ok) throw new Error(`Generated AgentPact report failed validation (${validation.status})`);

  await client.call("agentpact.submit_delivery", {
    milestoneId: milestone.id,
    submittedBy: state.agent_id,
    artifacts: [{ type: "url", value: deliverable.href }],
    notes: "Evidence-backed GitHub bounty reality check. The private signed report link remains available for 30 days.",
    apiKey: state.api_key,
  });
  operator.delivered[deal.id] = {
    delivered_at: new Date().toISOString(),
    funding_tx_hash: funding.txHash,
  };
  delivered += 1;
  stateChanged = true;
}

if (stateChanged) {
  operator.updated_at = new Date().toISOString();
  await writePrivateJson(operatorPath, operator);
}
console.log(JSON.stringify({ checked_deals: deals.length, accepted, delivered, waiting_funding: waitingFunding }));
