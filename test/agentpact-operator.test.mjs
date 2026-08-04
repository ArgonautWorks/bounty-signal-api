import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_USDC,
  ESCROW_ADDRESS,
  qualifyAgentPactDeal,
  verifyAgentPactFunding,
} from "../lib/agentpact-operator.mjs";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const OFFER_ID = "33333333-3333-4333-8333-333333333333";
const MILESTONE_ID = "44444444-4444-4444-8444-444444444444";
const TX_HASH = `0x${"ab".repeat(32)}`;

function deal(overrides = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    status: "proposed",
    offer_id: OFFER_ID,
    seller_agent_id: AGENT_ID,
    buyer_agent_id: BUYER_ID,
    currency: "USDC",
    negotiated_total: "0.500000",
    milestones: [{
      id: MILESTONE_ID,
      amount: 0.5,
      acceptance_criteria: ["Private evidence report link delivered"],
    }],
    ...overrides,
  };
}

test("qualifies only the exact bounded GitHub report contract", () => {
  const need = {
    title: "GitHub bounty viability check",
    description_md: "Check https://github.com/acme/widget/issues/42 before coding.",
  };
  const result = qualifyAgentPactDeal(deal(), need, { agent_id: AGENT_ID, offer_id: OFFER_ID });
  assert.equal(result.qualified, true);
  assert.equal(result.targetUrl, "https://github.com/acme/widget/issues/42");
  assert.equal(qualifyAgentPactDeal(deal({ negotiated_total: 1 }), need, {
    agent_id: AGENT_ID,
    offer_id: OFFER_ID,
  }).qualified, false);
  assert.equal(qualifyAgentPactDeal(deal({ milestones: [{
    id: MILESTONE_ID,
    amount: 0.5,
    acceptance_criteria: ["Report link delivered", "Write the implementation"],
  }] }), need, {
    agent_id: AGENT_ID,
    offer_id: OFFER_ID,
  }).qualified, false);
});

test("rejects cybersecurity and unrelated acceptance criteria", () => {
  const need = {
    title: "Security audit",
    description_md: "Exploit https://github.com/acme/widget/issues/42",
  };
  const result = qualifyAgentPactDeal(deal(), need, { agent_id: AGENT_ID, offer_id: OFFER_ID });
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.includes("forbidden_scope"));
});

test("independently verifies successful USDC funding into escrow", async () => {
  const escrowTopic = `0x${ESCROW_ADDRESS.toLowerCase().slice(2).padStart(64, "0")}`;
  const response = {
    ok: true,
    async json() {
      return { result: {
        status: "0x1",
        to: ESCROW_ADDRESS,
        logs: [{
          address: BASE_USDC,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
            `0x${"1".padStart(64, "0")}`,
            escrowTopic,
          ],
          data: `0x${(500_000n).toString(16)}`,
        }],
      } };
    },
  };
  const verified = await verifyAgentPactFunding({ status: "funded", funding_tx_hash: TX_HASH }, 0.5, {
    fetch: async () => response,
  });
  assert.deepEqual(verified, { verified: true, txHash: TX_HASH });
});

test("refuses database-funded status without a canonical receipt", async () => {
  const result = await verifyAgentPactFunding({ status: "funded" }, 0.5, {
    fetch: async () => { throw new Error("must not fetch without a hash"); },
  });
  assert.deepEqual(result, { verified: false, reason: "funding_hash_missing" });
});
