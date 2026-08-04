import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  authorizeAtelierReport,
  atelierReportMessage,
  renderAtelierReport,
} from "../lib/atelier-report.mjs";
import { extractGitHubIssueUrl } from "../lib/atelier-operator.mjs";

const TEST_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-08-04T12:00:00.000Z");

test("authorizes a canonical signed Atelier report link", async () => {
  const account = privateKeyToAccount(TEST_KEY);
  const expires = NOW.getTime() + 60_000;
  const report = atelierReportMessage({
    orderId: "ord_test_123456",
    url: "https://github.com/acme/widget/issues/42?tab=activity",
    expires,
  });
  const signature = await account.signMessage({ message: report.message });
  const authorized = await authorizeAtelierReport({
    order_id: report.orderId,
    url: report.target.canonicalUrl,
    expires: String(expires),
    signature,
  }, account.address, { now: NOW });

  assert.equal(authorized.target.canonicalUrl, "https://github.com/acme/widget/issues/42");
});

test("rejects expired and incorrectly signed report links", async () => {
  const account = privateKeyToAccount(TEST_KEY);
  const expired = atelierReportMessage({
    orderId: "ord_test_123456",
    url: "https://github.com/acme/widget/issues/42",
    expires: NOW.getTime() - 1,
  });
  const signature = await account.signMessage({ message: expired.message });
  await assert.rejects(
    authorizeAtelierReport({
      order_id: expired.orderId,
      url: expired.target.canonicalUrl,
      expires: String(expired.expires),
      signature,
    }, account.address, { now: NOW }),
    /expired/,
  );
});

test("extracts the public issue URL from structured marketplace requirements", () => {
  assert.equal(extractGitHubIssueUrl({
    requirements: { "GitHub issue URL": "https://github.com/acme/widget/issues/42?tab=activity" },
    brief: "Please check this.",
  }), "https://github.com/acme/widget/issues/42");
});

test("renders a noindex report and escapes upstream text", () => {
  const html = renderAtelierReport({
    target: { canonicalUrl: "https://github.com/acme/widget/issues/42" },
    verdict: "caution",
    score: 50,
    reasons: ["cash_reward_not_found"],
    evidence: { canonical_issue_state: "open", unsafe: "<script>alert(1)</script>" },
    recommendation: "Verify <terms>.",
    checked_at: NOW.toISOString(),
  }, "ord_test_123456");
  assert.match(html, /noindex,nofollow/);
  assert.match(html, /cash reward not found/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
