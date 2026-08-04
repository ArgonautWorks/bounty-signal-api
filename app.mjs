import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { evaluateGitHubBounty, parseGitHubIssueUrl } from "./lib/evaluate-github-bounty.mjs";

const PAY_TO = process.env.PAY_TO ?? "0x5e2023b1D1366d6366E768fe432AD627bfAa5d57";
const NETWORK = process.env.X402_NETWORK ?? "eip155:8453";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://facilitator.payai.network";
const PRICE = process.env.X402_PRICE ?? "$0.01";
const CACHE_TTL_MS = 5 * 60 * 1_000;
const cache = new Map();
const PUBLIC_SOURCE = "https://github.com/ArgonautWorks/bounty-signal-api";
const SERVICE_DESCRIPTION = "Canonical GitHub bounty viability checks for agents: live issue state, repository trust, payout evidence, age, claims, assignments, and competing pull requests.";

if (!/^0x[a-fA-F0-9]{40}$/.test(PAY_TO)) {
  throw new Error("PAY_TO must be an EVM address");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

const discovery = declareDiscoveryExtension({
  input: { url: "https://github.com/electron/electron/issues/48191" },
  inputSchema: {
    properties: {
      url: {
        type: "string",
        format: "uri",
        description: "Canonical public GitHub issue URL to assess as a paid bounty.",
      },
    },
    required: ["url"],
  },
  output: {
    example: {
      verdict: "reject",
      score: 0,
      reasons: ["canonical_issue_closed", "existing_competition"],
      evidence: { canonical_issue_state: "closed", competing_pull_requests: 12 },
    },
  },
});

app.use(paymentMiddleware({
  "GET /api/v1/check": {
    accepts: [{
      scheme: "exact",
      price: PRICE,
      network: NETWORK,
      payTo: PAY_TO,
    }],
    description: "Canonical GitHub bounty viability check for agents: issue state, repo trust, payout evidence, age, claims and competing PRs. Prevents wasted coding on stale or fake rewards.",
    mimeType: "application/json",
    serviceName: "ArgonautWorks Bounty Signal",
    tags: ["github", "bounties", "agent-tools", "due-diligence"],
    extensions: discovery,
  },
}, resourceServer));

app.get("/", (_request, response) => {
  response.json({
    service: "ArgonautWorks Bounty Signal API",
    purpose: "Reject stale, fake, crowded, or unfunded GitHub bounties before an agent spends implementation time.",
    endpoint: "GET /api/v1/check?url=https://github.com/{owner}/{repo}/issues/{number}",
    price: PRICE,
    settlement: { protocol: "x402", network: NETWORK, asset: "USDC" },
    health: "/health",
    openapi: "/openapi.json",
    x402_manifest: "/.well-known/x402",
    source: PUBLIC_SOURCE,
  });
});

app.get("/openapi.json", (request, response) => {
  const origin = `${request.protocol}://${request.get("host")}`;
  response.json({
    openapi: "3.1.0",
    info: {
      title: "ArgonautWorks Bounty Signal API",
      version: "0.1.0",
      description: SERVICE_DESCRIPTION,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: origin }],
    paths: {
      "/api/v1/check": {
        get: {
          operationId: "checkGitHubBounty",
          summary: "Check whether a public GitHub bounty is worth pursuing",
          parameters: [{
            name: "url",
            in: "query",
            required: true,
            schema: { type: "string", format: "uri" },
            example: "https://github.com/electron/electron/issues/48191",
          }],
          responses: {
            200: { description: "Evidence-backed viability decision" },
            400: { description: "Invalid GitHub issue URL" },
            402: { description: "x402 Base-USDC payment challenge" },
            502: { description: "Upstream GitHub lookup failed" },
          },
        },
      },
    },
  });
});

app.get("/.well-known/x402", (request, response) => {
  const origin = `${request.protocol}://${request.get("host")}`;
  response.json({
    x402Version: 2,
    serviceName: "ArgonautWorks Bounty Signal",
    description: SERVICE_DESCRIPTION,
    source: PUBLIC_SOURCE,
    resources: [{
      resource: `${origin}/api/v1/check`,
      method: "GET",
      price: PRICE,
      network: NETWORK,
      asset: "USDC",
      input: { queryParams: { url: "https://github.com/{owner}/{repo}/issues/{number}" } },
    }],
  });
});

app.get("/llms.txt", (_request, response) => {
  response.type("text/plain").send([
    "# ArgonautWorks Bounty Signal API",
    "",
    SERVICE_DESCRIPTION,
    "",
    "Paid endpoint: GET /api/v1/check?url=https://github.com/{owner}/{repo}/issues/{number}",
    `Price: ${PRICE} USDC on Base via x402 v2`,
    "OpenAPI: /openapi.json",
    "x402 manifest: /.well-known/x402",
    `Source: ${PUBLIC_SOURCE}`,
    "",
  ].join("\n"));
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "bounty-signal-api",
    version: "0.1.0",
    network: NETWORK,
    facilitator: new URL(FACILITATOR_URL).hostname,
    cache_entries: cache.size,
  });
});

app.get("/api/v1/check", async (request, response) => {
  try {
    const target = parseGitHubIssueUrl(request.query.url);
    const cached = cache.get(target.canonicalUrl);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      response.set("x-argonaut-cache", "hit").json(cached.value);
      return;
    }

    const result = await evaluateGitHubBounty(target.canonicalUrl);
    cache.set(target.canonicalUrl, { createdAt: Date.now(), value: result });
    response.set("x-argonaut-cache", "miss").json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to evaluate bounty";
    const status = /must (?:be|use|match)|valid GitHub issue URL/.test(message) ? 400 : 502;
    response.status(status).json({ error: message });
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: "not_found" });
});

export default app;
