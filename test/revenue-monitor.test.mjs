import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENTPACT_ACCEPT_MILESTONE_SELECTOR,
  AGENTPACT_ESCROW,
  AGENTPACT_REPORT_PAYOUT_ATOMIC,
  ATELIER_REPORT_PAYOUT_ATOMIC,
  ATELIER_TREASURY,
  ATELIER_X402_REPORT_PAYOUT_ATOMIC,
  BASE_USDC,
  DIRECT_REPORT_PRICE_ATOMIC,
  TRANSFER_SELECTOR,
  TRANSFER_TOPIC,
  classifyBountySignalTransfer,
  ledgerDate,
  revenueLedgerRow,
} from "../lib/revenue-monitor.mjs";

const WALLET = "0x5e2023b1d1366d6366e768fe432ad627bfaa5d57";
const PAYER = "0x1111111111111111111111111111111111111111";

function addressTopic(address) {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function paidLog(overrides = {}) {
  return {
    address: BASE_USDC,
    topics: [TRANSFER_TOPIC, addressTopic(PAYER), addressTopic(WALLET)],
    data: "0x2710",
    blockNumber: "0x2f3be51",
    transactionHash: "0xabc123",
    ...overrides,
  };
}

const paidTransaction = {
  to: BASE_USDC,
  input: "0xe3ee160e00000000",
};

test("classifies a confirmed external one-cent EIP-3009 transfer", () => {
  assert.deepEqual(classifyBountySignalTransfer(paidLog(), paidTransaction, WALLET), {
    experiment_id: "E014",
    kind: "api_revenue",
    revenue_usd: 0.01,
    product: "bounty_check",
    transaction: "0xabc123",
    payer: PAYER,
    amount_usdc_atomic: "10000",
    block_number: 49528401,
  });
});

test("classifies the distinct direct-report price without colliding with PayanAgent sales", () => {
  const report = classifyBountySignalTransfer(
    paidLog({ data: `0x${DIRECT_REPORT_PRICE_ATOMIC.toString(16)}`, transactionHash: "0xreport" }),
    paidTransaction,
    WALLET,
  );
  assert.deepEqual(report, {
    experiment_id: "E022",
    kind: "download_revenue",
    revenue_usd: 1.99,
    product: "direct_report",
    transaction: "0xreport",
    payer: PAYER,
    amount_usdc_atomic: "1990000",
    block_number: 49528401,
  });
  assert.match(revenueLedgerRow(report, new Date("2026-08-04T22:30:00.000Z")), /^2026-08-05,E022,download_revenue,0\.00,1\.99,1\.99,/);
});

test("classifies only the exact Atelier treasury payout for the marketplace report", () => {
  const receipt = classifyBountySignalTransfer(
    paidLog({
      topics: [TRANSFER_TOPIC, addressTopic(ATELIER_TREASURY), addressTopic(WALLET)],
      data: `0x${ATELIER_REPORT_PAYOUT_ATOMIC.toString(16)}`,
      transactionHash: "0xatelier",
    }),
    { to: BASE_USDC, input: `${TRANSFER_SELECTOR}00` },
    WALLET,
  );
  assert.deepEqual(receipt, {
    experiment_id: "E038",
    kind: "marketplace_revenue",
    revenue_usd: 0.45,
    product: "atelier_bounty_report",
    transaction: "0xatelier",
    payer: ATELIER_TREASURY,
    amount_usdc_atomic: "450000",
    block_number: 49528401,
  });
  assert.match(revenueLedgerRow(receipt, new Date("2026-08-04T22:30:00.000Z")), /^2026-08-05,E038,marketplace_revenue,0\.00,0\.45,0\.45,/);

  const x402Receipt = classifyBountySignalTransfer(
    paidLog({
      topics: [TRANSFER_TOPIC, addressTopic(ATELIER_TREASURY), addressTopic(WALLET)],
      data: `0x${ATELIER_X402_REPORT_PAYOUT_ATOMIC.toString(16)}`,
      transactionHash: "0xatelierx402",
    }),
    { to: BASE_USDC, input: `${TRANSFER_SELECTOR}00` },
    WALLET,
  );
  assert.equal(x402Receipt.revenue_usd, 0.5);
});

test("classifies only an AgentPact escrow release for the exact report payout", () => {
  const receipt = classifyBountySignalTransfer(
    paidLog({
      topics: [TRANSFER_TOPIC, addressTopic(AGENTPACT_ESCROW), addressTopic(WALLET)],
      data: `0x${AGENTPACT_REPORT_PAYOUT_ATOMIC.toString(16)}`,
      transactionHash: "0xagentpact",
    }),
    { to: AGENTPACT_ESCROW, input: `${AGENTPACT_ACCEPT_MILESTONE_SELECTOR}00` },
    WALLET,
  );
  assert.deepEqual(receipt, {
    experiment_id: "E043",
    kind: "marketplace_revenue",
    revenue_usd: 0.45,
    product: "agentpact_bounty_report",
    transaction: "0xagentpact",
    payer: AGENTPACT_ESCROW,
    amount_usdc_atomic: "450000",
    block_number: 49528401,
  });
  assert.match(revenueLedgerRow(receipt), /Settled AgentPact GitHub Bounty Reality Check payout/);
  assert.equal(classifyBountySignalTransfer(
    paidLog({
      topics: [TRANSFER_TOPIC, addressTopic(AGENTPACT_ESCROW), addressTopic(WALLET)],
      data: `0x${AGENTPACT_REPORT_PAYOUT_ATOMIC.toString(16)}`,
    }),
    { to: BASE_USDC, input: `${TRANSFER_SELECTOR}00` },
    WALLET,
  ), null);
});

test("rejects self-seeds, other amounts, and ordinary transfers", () => {
  assert.equal(classifyBountySignalTransfer(
    paidLog({ topics: [TRANSFER_TOPIC, addressTopic(WALLET), addressTopic(WALLET)] }),
    paidTransaction,
    WALLET,
  ), null);
  assert.equal(classifyBountySignalTransfer(paidLog({ data: "0x4e20" }), paidTransaction, WALLET), null);
  assert.equal(classifyBountySignalTransfer(paidLog(), { ...paidTransaction, input: "0xa9059cbb" }, WALLET), null);
});

test("formats a realized-revenue row without treating the self-seed as income", () => {
  const receipt = classifyBountySignalTransfer(paidLog(), paidTransaction, WALLET);
  const date = new Date("2026-08-04T22:30:00.000Z");
  assert.equal(ledgerDate(date), "2026-08-05");
  assert.equal(
    revenueLedgerRow(receipt, date),
    "2026-08-05,E014,api_revenue,0.00,0.01,0.01,Settled external x402 bounty check; Base transaction 0xabc123; payer 0x1111111111111111111111111111111111111111",
  );
});
