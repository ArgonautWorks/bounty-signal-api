import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const ENDPOINT = process.env.BOUNTY_SIGNAL_ENDPOINT
  ?? "https://argonaut-bounty-signal.vercel.app/api/v1/check";
const TARGET_ISSUE = "https://github.com/electron/electron/issues/48191";
const WALLET_FILE = process.env.BOUNTY_SIGNAL_WALLET_FILE
  ?? "/home/oak/.local/state/venture-lab/frantic-wallet.json";
const STATE_FILE = process.env.BOUNTY_SIGNAL_SEED_STATE
  ?? "/home/oak/.local/state/venture-lab/bounty-signal-bazaar.json";
const FACILITATOR_DISCOVERY = "https://facilitator.payai.network/discovery/resources";
const BASE_RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const EXPECTED_NETWORK = "eip155:8453";
const EXPECTED_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAX_AMOUNT_ATOMIC = 10_000n;

function writeState(value) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, STATE_FILE);
  fs.chmodSync(STATE_FILE, 0o600);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function rpc(method, params) {
  const response = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Base RPC returned ${response.status}`);
  const value = await response.json();
  if (value.error) throw new Error(`Base RPC error ${value.error.code}`);
  return value.result;
}

async function usdcBalance(address) {
  const paddedAddress = address.slice(2).toLowerCase().padStart(64, "0");
  const result = await rpc("eth_call", [{
    to: EXPECTED_ASSET,
    data: `0x70a08231${paddedAddress}`,
  }, "latest"]);
  return BigInt(result);
}

async function isListed(address) {
  const response = await fetch(`${FACILITATOR_DISCOVERY}?limit=1000&offset=0`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return false;
  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.some((item) => {
    const matchingResource = String(item.resource ?? "").startsWith(ENDPOINT);
    const matchingWallet = (item.accepts ?? []).some((option) =>
      String(option.payTo ?? "").toLowerCase() === address.toLowerCase());
    return matchingResource && matchingWallet;
  });
}

function decodeHeader(value) {
  if (!value) return null;
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

async function main() {
  const previous = readState();
  if (previous?.seeded === true) {
    console.log("Bazaar seed already completed");
    return;
  }

  const wallet = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
  const privateKey = String(wallet.private_key).startsWith("0x")
    ? String(wallet.private_key)
    : `0x${wallet.private_key}`;
  const signer = privateKeyToAccount(privateKey);
  if (signer.address.toLowerCase() !== String(wallet.address).toLowerCase()) {
    throw new Error("wallet address does not match private key");
  }

  if (await isListed(signer.address)) {
    writeState({ seeded: true, status: "already_listed", checked_at: new Date().toISOString() });
    console.log("Bazaar listing already exists");
    return;
  }

  const balance = await usdcBalance(signer.address);
  if (balance < MAX_AMOUNT_ATOMIC) {
    writeState({
      seeded: false,
      status: "awaiting_balance",
      checked_at: new Date().toISOString(),
      required_usdc_atomic: MAX_AMOUNT_ATOMIC.toString(),
      observed_usdc_atomic: balance.toString(),
    });
    console.log("Bazaar seed deferred: receiving wallet has less than $0.01 USDC");
    return;
  }

  const url = `${ENDPOINT}?url=${encodeURIComponent(TARGET_ISSUE)}`;
  const unpaid = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const unpaidBody = await unpaid.json();
  if (unpaid.status !== 402) throw new Error(`expected 402 challenge, received ${unpaid.status}`);

  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(signer));
  const httpClient = new x402HTTPClient(coreClient);
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => unpaid.headers.get(name),
    unpaidBody,
  );
  if (!String(paymentRequired.resource?.url ?? "").startsWith(ENDPOINT)) {
    throw new Error("payment challenge resource does not match configured endpoint");
  }
  const option = paymentRequired.accepts?.[0];
  if (!option) throw new Error("payment challenge did not include an accepted payment option");
  if (option.network !== EXPECTED_NETWORK) throw new Error("unexpected payment network");
  if (String(option.asset).toLowerCase() !== EXPECTED_ASSET.toLowerCase()) {
    throw new Error("unexpected payment asset");
  }
  if (String(option.payTo).toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("seed payment must be a self-payment to the receiving wallet");
  }
  if (BigInt(option.amount) > MAX_AMOUNT_ATOMIC) throw new Error("payment exceeds $0.01 safety cap");

  const payload = await httpClient.createPaymentPayload(paymentRequired);
  const paid = await fetch(url, {
    headers: httpClient.encodePaymentSignatureHeader(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await paid.text();
  const settlement = decodeHeader(paid.headers.get("payment-response"));
  if (!paid.ok || !settlement?.success) {
    throw new Error(`self-payment failed with ${paid.status}: ${body.slice(0, 300)}`);
  }

  writeState({
    seeded: true,
    status: "settled_self_payment",
    checked_at: new Date().toISOString(),
    transaction: settlement.transaction ?? null,
    network: EXPECTED_NETWORK,
    amount_usdc_atomic: String(option.amount),
    net_principal_spend_usd: 0,
  });
  console.log("Bazaar seed self-payment settled; catalog indexing requested");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
