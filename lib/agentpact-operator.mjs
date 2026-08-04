import { randomUUID } from "node:crypto";
import { parseGitHubIssueUrl } from "./evaluate-github-bounty.mjs";

export const DEFAULT_AGENTPACT_STATE = "/home/oak/.local/state/venture-lab/agentpact-agent.json";
export const AGENTPACT_API = "https://api.agentpact.xyz/api";
export const AGENTPACT_MCP = "https://mcp.agentpact.xyz/mcp";
export const BASE_RPC = "https://mainnet.base.org";
export const ESCROW_ADDRESS = "0x588168712bF758aFD747bF46471afa53f9599A64";
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const OFFER_PRICE_USDC = 0.5;

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function parseEventStream(text) {
  const payloads = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  return payloads.at(-1) ?? null;
}

function parseToolResult(result) {
  if (result?.isError) {
    const message = result.content?.map((item) => item.text).filter(Boolean).join(" ") || "unknown tool error";
    throw new Error(`AgentPact MCP tool failed: ${message}`);
  }
  if (result?.structuredContent && Object.keys(result.structuredContent).length > 0) {
    return result.structuredContent;
  }
  for (const item of result?.content ?? []) {
    if (item.type !== "text") continue;
    try {
      return JSON.parse(item.text);
    } catch {
      // Keep scanning; tools normally return JSON in a text block.
    }
  }
  return result;
}

export class AgentPactMcpClient {
  constructor(options = {}) {
    this.url = options.url ?? AGENTPACT_MCP;
    this.fetch = options.fetch ?? fetch;
    this.session = null;
    this.nextId = 1;
  }

  async request(method, params = {}, notification = false) {
    const response = await this.fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(this.session ? { "mcp-session-id": this.session } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(!notification ? { id: this.nextId++ } : {}),
        method,
        params,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok && response.status !== 202) {
      throw new Error(`AgentPact MCP ${response.status} for ${method}`);
    }
    this.session = response.headers.get("mcp-session-id") ?? this.session;
    const text = await response.text();
    if (notification || !text.trim()) return null;
    const envelope = response.headers.get("content-type")?.includes("text/event-stream")
      ? parseEventStream(text)
      : JSON.parse(text);
    if (envelope?.error) throw new Error(`AgentPact MCP error: ${envelope.error.message}`);
    return envelope?.result;
  }

  async initialize() {
    if (this.session) return;
    await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "ArgonautWorks Bounty Signal", version: "0.4.0" },
    });
    await this.request("notifications/initialized", {}, true);
  }

  async call(name, args) {
    await this.initialize();
    return parseToolResult(await this.request("tools/call", { name, arguments: args }));
  }
}

export async function agentPactPublicGet(path, options = {}) {
  const response = await (options.fetch ?? fetch)(`${options.apiBase ?? AGENTPACT_API}${path}`, {
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AgentPact API ${response.status} for ${path}`);
  return body;
}

export async function registerAgent(walletAddress, options = {}) {
  const agentId = options.agentId ?? randomUUID();
  const response = await (options.fetch ?? fetch)(`${options.apiBase ?? AGENTPACT_API}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, walletAddress }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AgentPact registration failed (${response.status})`);
  const data = body.data ?? body;
  const apiKey = data.apiKey ?? data.api_key;
  if (!apiKey) throw new Error("AgentPact registration omitted its API key");
  return { agentId, apiKey, response: data };
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
}

export function extractAgentPactIssueUrl(...values) {
  for (const candidate of stringsIn(values)) {
    const urls = candidate.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+(?:[^\s"'<>]*)?/g) ?? [];
    for (const url of urls) {
      try {
        return parseGitHubIssueUrl(url).canonicalUrl;
      } catch {
        // Keep scanning.
      }
    }
  }
  return null;
}

export function qualifyAgentPactDeal(deal, need, state) {
  const reasons = [];
  if (deal?.status !== "proposed") reasons.push("not_proposed");
  if (deal?.offer_id !== state.offer_id) reasons.push("wrong_offer");
  if (deal?.seller_agent_id !== state.agent_id) reasons.push("wrong_seller");
  if (!deal?.buyer_agent_id || deal.buyer_agent_id === state.agent_id) reasons.push("self_or_missing_buyer");
  if (String(deal?.currency).toUpperCase() !== "USDC") reasons.push("unsupported_currency");
  if (Number(deal?.negotiated_total) !== OFFER_PRICE_USDC) reasons.push("wrong_price");

  const milestones = Array.isArray(deal?.milestones) ? deal.milestones : [];
  if (milestones.length !== 1 || Number(milestones[0]?.amount) !== OFFER_PRICE_USDC) {
    reasons.push("invalid_milestones");
  }
  const acceptanceItems = stringsIn(milestones.map((item) => item.acceptance_criteria));
  const acceptance = acceptanceItems.join(" ").toLowerCase();
  const fullScope = stringsIn([need, milestones]).join(" ").toLowerCase();
  const targetUrl = extractAgentPactIssueUrl(need, milestones);
  if (!targetUrl) reasons.push("missing_github_issue_url");
  if (!/(bounty|github|issue|viability|reality check)/.test(fullScope)) reasons.push("scope_mismatch");
  if (!/(report|link|verdict|viability|reality check|evidence)/.test(acceptance)) reasons.push("acceptance_mismatch");
  if (acceptanceItems.some((item) =>
    !/(report|link|verdict|viability|reality check|evidence|github issue|recommendation)/i.test(item)
      || /(code|implement|build|develop|write|design|scrape|audit|fix|pull request|email|video|contact|publish|post)/i.test(item),
  )) reasons.push("acceptance_expands_scope");
  if (/(security audit|penetration|pentest|exploit|vulnerabilit|malware|phishing|captcha|social media|post on|send email|contact customer|phone call)/.test(fullScope)) {
    reasons.push("forbidden_scope");
  }
  return { qualified: reasons.length === 0, reasons, targetUrl, milestone: milestones[0] ?? null };
}

function findTransactionHash(value) {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (/tx.*hash|transaction.*hash|fund.*hash/i.test(key) && /^0x[0-9a-f]{64}$/i.test(String(nested))) {
      return String(nested);
    }
    const found = findTransactionHash(nested);
    if (found) return found;
  }
  return null;
}

function containsFundedStatus(value) {
  return stringsIn(value).some((item) => /^(funded|confirmed)$/i.test(item));
}

export async function verifyAgentPactFunding(payment, expectedUsd, options = {}) {
  if (!containsFundedStatus(payment)) return { verified: false, reason: "payment_not_funded" };
  const txHash = findTransactionHash(payment);
  if (!txHash) return { verified: false, reason: "funding_hash_missing" };
  const response = await (options.fetch ?? fetch)(options.rpcUrl ?? BASE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  const receipt = body.result;
  if (!response.ok || !receipt || receipt.status !== "0x1") return { verified: false, reason: "receipt_not_successful" };
  if (String(receipt.to).toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) {
    return { verified: false, reason: "wrong_receipt_target" };
  }
  const expectedAtomic = BigInt(Math.round(Number(expectedUsd) * 1_000_000));
  const escrowTopic = `0x${ESCROW_ADDRESS.toLowerCase().slice(2).padStart(64, "0")}`;
  const transfer = (receipt.logs ?? []).find((log) =>
    String(log.address).toLowerCase() === BASE_USDC.toLowerCase()
      && String(log.topics?.[0]).toLowerCase() === TRANSFER_TOPIC
      && String(log.topics?.[2]).toLowerCase() === escrowTopic
      && /^0x[0-9a-f]+$/i.test(String(log.data))
      && BigInt(log.data) >= expectedAtomic,
  );
  return transfer
    ? { verified: true, txHash }
    : { verified: false, reason: "escrow_usdc_transfer_missing" };
}
