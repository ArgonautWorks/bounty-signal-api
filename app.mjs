import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { evaluateGitHubBounty, parseGitHubIssueUrl } from "./lib/evaluate-github-bounty.mjs";
import {
  DIRECT_REPORT_PRICE,
  REPORT_EDITION,
  loadReportContent,
} from "./lib/report.mjs";

const PAY_TO = process.env.PAY_TO ?? "0x5e2023b1D1366d6366E768fe432AD627bfAa5d57";
const NETWORK = process.env.X402_NETWORK ?? "eip155:8453";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL ?? "https://facilitator.payai.network";
const PRICE = process.env.X402_PRICE ?? "$0.01";
const CACHE_TTL_MS = 5 * 60 * 1_000;
const cache = new Map();
const PUBLIC_SOURCE = "https://github.com/ArgonautWorks/bounty-signal-api";
const SERVICE_VERSION = "0.2.0";
const SERVICE_DESCRIPTION = "Canonical GitHub bounty viability checks for agents: live issue state, repository trust, payout evidence, age, claims, assignments, and competing pull requests.";
const DISCOVERY_GUIDANCE = [
  "Use this API before committing implementation time to a public GitHub issue advertised as a paid bounty.",
  "Pass the canonical public GitHub issue URL in the required url query parameter.",
  "The paid JSON response returns a verdict, score, explicit reasons, and current evidence about issue state, repository trust, payout signals, assignments, claims, and competing pull requests.",
  "Treat reject as a stop signal, caution as a prompt for further verification, and viable as one input to an independent execution decision.",
].join(" ");
const REPORT_CONTENT = process.env.REPORT_CONTENT_B64
  ? loadReportContent(process.env.REPORT_CONTENT_B64)
  : null;

if (!/^0x[a-fA-F0-9]{40}$/.test(PAY_TO)) {
  throw new Error("PAY_TO must be an EVM address");
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "8kb" }));

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

const postDiscovery = declareDiscoveryExtension({
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
  bodyType: "json",
  output: {
    example: {
      verdict: "reject",
      score: 0,
      reasons: ["canonical_issue_closed", "existing_competition"],
      evidence: { canonical_issue_state: "closed", competing_pull_requests: 12 },
    },
  },
});

const paidCheckResource = {
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
};
const paidCheckPostResource = { ...paidCheckResource, extensions: postDiscovery };

const reportDiscovery = declareDiscoveryExtension({
  input: { edition: REPORT_EDITION },
  inputSchema: {
    properties: {
      edition: {
        type: "string",
        const: REPORT_EDITION,
        description: "Pinned report edition to download.",
      },
    },
    required: ["edition"],
  },
  output: {
    example: {
      edition: REPORT_EDITION,
      format: "text/markdown",
      body: "# Agent Bounty Reality Check — 1,291 listings screened",
    },
  },
});

const reportPostDiscovery = declareDiscoveryExtension({
  input: { edition: REPORT_EDITION },
  inputSchema: {
    properties: {
      edition: {
        type: "string",
        const: REPORT_EDITION,
        description: "Pinned report edition to download.",
      },
    },
    required: ["edition"],
  },
  bodyType: "json",
  output: {
    example: {
      edition: REPORT_EDITION,
      format: "text/markdown",
      body: "# Agent Bounty Reality Check — 1,291 listings screened",
    },
  },
});

const paidReportResource = {
  accepts: [{
    scheme: "exact",
    price: DIRECT_REPORT_PRICE,
    network: NETWORK,
    payTo: PAY_TO,
  }],
  description: "Download the dated Agent Bounty Reality Check: 1,291 listings screened, verified false leads, marketplace delivery evidence, and a reusable triage policy.",
  mimeType: "text/markdown",
  serviceName: "ArgonautWorks Agent Bounty Reality Check",
  tags: ["bounties", "market-research", "agent-tools", "download"],
  extensions: reportDiscovery,
};
const paidReportPostResource = { ...paidReportResource, extensions: reportPostDiscovery };

app.use(paymentMiddleware({
  "GET /api/v1/check": paidCheckResource,
  "POST /api/v1/check": paidCheckPostResource,
  "GET /api/v1/report": paidReportResource,
  "POST /api/v1/report": paidReportPostResource,
}, resourceServer));

app.get("/", (_request, response) => {
  response.json({
    service: "ArgonautWorks Bounty Signal API",
    purpose: "Reject stale, fake, crowded, or unfunded GitHub bounties before an agent spends implementation time.",
    endpoint: "GET with a url query parameter or POST {\"url\":\"https://github.com/{owner}/{repo}/issues/{number}\"} to /api/v1/check",
    price: PRICE,
    report: {
      endpoint: `/api/v1/report?edition=${REPORT_EDITION}`,
      price: DIRECT_REPORT_PRICE,
      format: "text/markdown",
    },
    settlement: { protocol: "x402", network: NETWORK, asset: "USDC" },
    health: "/health",
    openapi: "/openapi.json",
    agent_card: "/.well-known/agent.json",
    x402_manifest: "/.well-known/x402",
    source: PUBLIC_SOURCE,
  });
});

app.get("/.well-known/agent.json", (request, response) => {
  const origin = `${request.protocol}://${request.get("host")}`;
  response.json({
    name: "ArgonautWorks",
    description: "Autonomous due-diligence tools and evidence products that help agents avoid wasting time on stale, fake, crowded, or unfunded work.",
    url: origin,
    version: SERVICE_VERSION,
    provider: {
      organization: "ArgonautWorks",
      url: PUBLIC_SOURCE,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
    documentation: {
      openapi: `${origin}/openapi.json`,
      x402: `${origin}/.well-known/x402`,
      source: PUBLIC_SOURCE,
    },
    skills: [
      {
        id: "bounty-signal",
        name: "Check GitHub Bounty Viability",
        description: "Return an evidence-backed viability verdict before committing implementation time to a public GitHub bounty.",
        uri: `${origin}/api/v1/check`,
        method: "POST",
        security: ["x402"],
      },
      {
        id: "schedule-fit",
        name: "Find Meeting Overlap",
        description: "Compute practical meeting windows across time zones from a structured request.",
        uri: "https://payanagent.com/x402/kh76a21tcy1z0fh5s1vqnwppqs8bt6m8",
        method: "POST",
        security: ["x402"],
      },
      {
        id: "bounty-reality-check",
        name: "Buy Agent Bounty Reality Check",
        description: "Download a dated screen of 1,291 bounty listings, verified false leads, delivery evidence, and a reusable triage policy.",
        uri: `${origin}/api/v1/report`,
        method: "POST",
        security: ["x402"],
      },
    ],
    securitySchemes: {
      x402: {
        type: "x402",
        description: "USDC payment via x402 on Base mainnet. Call the skill URI without payment to receive exact HTTP 402 requirements.",
      },
    },
  });
});

app.get("/openapi.json", (request, response) => {
  const origin = `${request.protocol}://${request.get("host")}`;
  response.json({
    openapi: "3.1.0",
    info: {
      title: "ArgonautWorks Bounty Signal API",
      version: SERVICE_VERSION,
      description: SERVICE_DESCRIPTION,
      license: { name: "MIT", identifier: "MIT" },
      contact: { name: "ArgonautWorks", url: PUBLIC_SOURCE },
      "x-guidance": DISCOVERY_GUIDANCE,
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
            description: "Canonical public GitHub issue URL to assess as a paid bounty.",
            schema: { type: "string", format: "uri" },
            example: "https://github.com/electron/electron/issues/48191",
          }],
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.01" },
            protocols: [{ x402: {} }],
          },
          responses: {
            200: {
              description: "Evidence-backed viability decision",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["verdict", "score", "reasons", "evidence"],
                    properties: {
                      verdict: { type: "string", enum: ["viable", "caution", "reject"] },
                      score: { type: "number" },
                      reasons: { type: "array", items: { type: "string" } },
                      evidence: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
            400: { description: "Invalid GitHub issue URL" },
            402: { description: "x402 Base-USDC payment challenge" },
            502: { description: "Upstream GitHub lookup failed" },
          },
        },
        post: {
          operationId: "checkGitHubBountyFromJson",
          summary: "Check whether a public GitHub bounty is worth pursuing",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  additionalProperties: false,
                  properties: {
                    url: {
                      type: "string",
                      format: "uri",
                      description: "Canonical public GitHub issue URL to assess as a paid bounty.",
                    },
                  },
                },
                example: { url: "https://github.com/electron/electron/issues/48191" },
              },
            },
          },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.01" },
            protocols: [{ x402: {} }],
          },
          responses: {
            200: { description: "Evidence-backed viability decision" },
            400: { description: "Invalid GitHub issue URL" },
            402: { description: "x402 Base-USDC payment challenge" },
            502: { description: "Upstream GitHub lookup failed" },
          },
        },
      },
      "/api/v1/report": {
        get: {
          operationId: "downloadAgentBountyRealityCheck",
          summary: "Download the Agent Bounty Reality Check",
          parameters: [{
            name: "edition",
            in: "query",
            required: true,
            description: "Pinned report edition.",
            schema: { type: "string", const: REPORT_EDITION },
            example: REPORT_EDITION,
          }],
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "1.99" },
            protocols: [{ x402: {} }],
          },
          responses: {
            200: {
              description: "Dated evidence report",
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            402: { description: "x402 Base-USDC payment challenge" },
            503: { description: "Pinned report content is unavailable" },
          },
        },
        post: {
          operationId: "downloadAgentBountyRealityCheckFromJson",
          summary: "Download the Agent Bounty Reality Check",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["edition"],
                  additionalProperties: false,
                  properties: { edition: { type: "string", const: REPORT_EDITION } },
                },
                example: { edition: REPORT_EDITION },
              },
            },
          },
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "1.99" },
            protocols: [{ x402: {} }],
          },
          responses: {
            200: {
              description: "Dated evidence report",
              content: { "text/markdown": { schema: { type: "string" } } },
            },
            402: { description: "x402 Base-USDC payment challenge" },
            503: { description: "Pinned report content is unavailable" },
          },
        },
      },
    },
  });
});

app.get(["/favicon.ico", "/favicon.svg"], (_request, response) => {
  response.type("image/svg+xml").send([
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<rect width="64" height="64" rx="14" fill="#171717"/>',
    '<path d="M14 46 28 14h8l14 32h-9l-3-8H25l-3 8h-8Zm14-16h7l-3.5-9L28 30Z" fill="#f5f5f5"/>',
    "</svg>",
  ].join(""));
});

app.get("/.well-known/x402", (request, response) => {
  const origin = `${request.protocol}://${request.get("host")}`;
  response.json({
    x402Version: 2,
    serviceName: "ArgonautWorks Bounty Signal",
    description: SERVICE_DESCRIPTION,
    source: PUBLIC_SOURCE,
    resources: [
      {
        resource: `${origin}/api/v1/check`,
        method: "GET",
        price: PRICE,
        network: NETWORK,
        asset: "USDC",
        input: { queryParams: { url: "https://github.com/{owner}/{repo}/issues/{number}" } },
      },
      {
        resource: `${origin}/api/v1/check`,
        method: "POST",
        price: PRICE,
        network: NETWORK,
        asset: "USDC",
        input: { body: { url: "https://github.com/{owner}/{repo}/issues/{number}" } },
      },
      {
        resource: `${origin}/api/v1/report`,
        method: "GET",
        price: DIRECT_REPORT_PRICE,
        network: NETWORK,
        asset: "USDC",
        input: { queryParams: { edition: REPORT_EDITION } },
      },
      {
        resource: `${origin}/api/v1/report`,
        method: "POST",
        price: DIRECT_REPORT_PRICE,
        network: NETWORK,
        asset: "USDC",
        input: { body: { edition: REPORT_EDITION } },
      },
    ],
  });
});

app.get("/llms.txt", (_request, response) => {
  response.type("text/plain").send([
    "# ArgonautWorks Bounty Signal API",
    "",
    SERVICE_DESCRIPTION,
    "",
    "Paid endpoint: GET /api/v1/check?url=https://github.com/{owner}/{repo}/issues/{number}",
    "Marketplace-compatible endpoint: POST /api/v1/check with JSON {\"url\":\"https://github.com/{owner}/{repo}/issues/{number}\"}",
    `Price: ${PRICE} USDC on Base via x402 v2`,
    `Paid report: GET /api/v1/report?edition=${REPORT_EDITION} or POST /api/v1/report with JSON {\"edition\":\"${REPORT_EDITION}\"}`,
    `Direct report price: ${DIRECT_REPORT_PRICE} USDC on Base via x402 v2`,
    "OpenAPI: /openapi.json",
    "A2A agent card: /.well-known/agent.json",
    "x402 manifest: /.well-known/x402",
    `Source: ${PUBLIC_SOURCE}`,
    "",
  ].join("\n"));
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "bounty-signal-api",
    version: SERVICE_VERSION,
    network: NETWORK,
    facilitator: new URL(FACILITATOR_URL).hostname,
    cache_entries: cache.size,
    report_available: Boolean(REPORT_CONTENT),
  });
});

app.all("/api/v1/report", (_request, response) => {
  if (!REPORT_CONTENT) {
    response.status(503).json({ error: "report_unavailable" });
    return;
  }
  response
    .type("text/markdown")
    .set("content-disposition", `attachment; filename=\"agent-bounty-reality-check-${REPORT_EDITION}.md\"`)
    .set("x-argonaut-report-edition", REPORT_EDITION)
    .send(REPORT_CONTENT);
});

app.all("/api/v1/check", async (request, response) => {
  try {
    const target = parseGitHubIssueUrl(request.method === "POST" ? request.body?.url : request.query.url);
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
