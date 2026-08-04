import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  agentPactReportMessage,
  authorizeAgentPactReport,
  renderAgentPactReport,
} from "../lib/atelier-report.mjs";

const TEST_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const DEAL_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-04T12:00:00.000Z");

test("authorizes a canonical signed AgentPact report", async () => {
  const account = privateKeyToAccount(TEST_KEY);
  const report = agentPactReportMessage({
    dealId: DEAL_ID,
    url: "https://github.com/acme/widget/issues/42?tab=activity",
    expires: NOW.getTime() + 60_000,
  });
  const signature = await account.signMessage({ message: report.message });
  const access = await authorizeAgentPactReport({
    deal_id: DEAL_ID,
    url: report.target.canonicalUrl,
    expires: String(report.expires),
    signature,
  }, account.address, { now: NOW });
  assert.equal(access.target.canonicalUrl, "https://github.com/acme/widget/issues/42");
});

test("renders an escaped noindex AgentPact report", () => {
  const html = renderAgentPactReport({
    target: { canonicalUrl: "https://github.com/acme/widget/issues/42" },
    verdict: "caution",
    score: 50,
    reasons: ["cash_reward_not_found"],
    evidence: { unsafe: "<script>alert(1)</script>" },
    recommendation: "Verify terms.",
    checked_at: NOW.toISOString(),
  }, DEAL_ID);
  assert.match(html, /paid AgentPact deal/);
  assert.match(html, /noindex,nofollow/);
  assert.doesNotMatch(html, /<script>alert/);
});
