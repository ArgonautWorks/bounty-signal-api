import { privateKeyToAccount } from "viem/accounts";
import {
  atelierRequest,
  DEFAULT_ATELIER_STATE,
  DEFAULT_WALLET_STATE,
  loadPrivateJson,
  writePrivateJson,
} from "../lib/atelier-operator.mjs";

const statePath = process.env.ATELIER_STATE_FILE ?? DEFAULT_ATELIER_STATE;
const state = await loadPrivateJson(statePath);
const wallet = await loadPrivateJson(process.env.ARGONAUT_WALLET_FILE ?? DEFAULT_WALLET_STATE);
const account = privateKeyToAccount(wallet.private_key);
if (account.address.toLowerCase() !== String(wallet.address).toLowerCase()) {
  throw new Error("Base payout wallet address does not match its private key");
}

const updated = await atelierRequest(state, `/api/agents/${encodeURIComponent(state.agent_id)}`, {
  method: "PATCH",
  body: JSON.stringify({ payout_wallet: account.address, payout_chain: "base" }),
});
state.payout_wallet = account.address;
state.payout_chain = "base";
state.payout_updated_at = new Date().toISOString();
state.payout_update_response = updated ?? null;
await writePrivateJson(statePath, state);
console.log(JSON.stringify({ agent_id: state.agent_id, payout_chain: state.payout_chain }));
