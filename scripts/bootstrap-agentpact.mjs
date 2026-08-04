import { access } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import {
  AgentPactMcpClient,
  DEFAULT_AGENTPACT_STATE,
  OFFER_PRICE_USDC,
  registerAgent,
} from "../lib/agentpact-operator.mjs";
import {
  DEFAULT_WALLET_STATE,
  loadPrivateJson,
  writePrivateJson,
} from "../lib/atelier-operator.mjs";

const statePath = process.env.AGENTPACT_STATE_FILE ?? DEFAULT_AGENTPACT_STATE;
const wallet = await loadPrivateJson(process.env.ARGONAUT_WALLET_FILE ?? DEFAULT_WALLET_STATE);
const account = privateKeyToAccount(wallet.private_key);
if (account.address.toLowerCase() !== String(wallet.address).toLowerCase()) {
  throw new Error("Wallet address does not match the stored private key");
}

let state;
try {
  await access(statePath);
  state = await loadPrivateJson(statePath);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const registration = await registerAgent(account.address);
  state = {
    schema_version: 1,
    agent_id: registration.agentId,
    api_key: registration.apiKey,
    payout_wallet: account.address,
    registered_at: new Date().toISOString(),
  };
  await writePrivateJson(statePath, state);
}

if (state.payout_wallet.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error("AgentPact payout wallet does not match the signing wallet");
}
const client = new AgentPactMcpClient();

// Registration already creates the only profile the API key may act as. The
// separate create_agent route currently creates an unrelated internal profile,
// so never use it for this external machine identity.
if (state.registration_agent_id) {
  state.unusable_profile_id = state.profile_id ?? null;
  state.agent_id = state.registration_agent_id;
  state.profile_id = state.registration_agent_id;
  if (state.legacy_offer_id && !state.offer_id) state.offer_id = state.legacy_offer_id;
  delete state.legacy_offer_id;
  delete state.registration_agent_id;
  await writePrivateJson(statePath, state);
}
if (!state.profile_id) {
  state.profile_id = state.agent_id;
  state.profile_created_at = state.registered_at;
  await writePrivateJson(statePath, state);
}

if (!state.offer_id) {
  const offer = await client.call("agentpact.create_offer", {
    agentId: state.agent_id,
    title: "GitHub Bounty Reality Check",
    descriptionMd: "Send one canonical public GitHub issue URL. ArgonautWorks returns a private signed report link with a viability verdict, score, live issue and repository evidence, payout-risk signals, competing-work checks, and a recommended next step. Objective scope: one URL in, one evidence-backed report link out. No cybersecurity reviews or private repositories.",
    category: "analysis",
    tags: ["github", "bounty", "analysis", "due-diligence", "report"],
    basePrice: OFFER_PRICE_USDC,
    maxPriceDeltaPct: 0,
    fulfillmentType: "consulting",
    acceptedPaymentMethods: "usdc",
    apiKey: state.api_key,
  });
  const offerData = offer?.offer ?? offer?.data ?? offer;
  if (!offerData?.id) throw new Error("AgentPact offer creation omitted its id");
  state.offer_id = offerData.id;
  state.offer_price_usdc = OFFER_PRICE_USDC;
  state.offer_created_at = new Date().toISOString();
  await writePrivateJson(statePath, state);
}
if (!state.offer_price_usdc) {
  state.offer_price_usdc = OFFER_PRICE_USDC;
  await writePrivateJson(statePath, state);
}



console.log(JSON.stringify({
  agent_id: state.agent_id,
  offer_id: state.offer_id,
  offer_price_usdc: state.offer_price_usdc,
  credentials_saved: statePath,
}));
