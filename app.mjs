import express from "express";
import { randomUUID } from "node:crypto";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { evaluateGitHubBounty, parseGitHubIssueUrl } from "./lib/evaluate-github-bounty.mjs";
import {
  AgentPactReportAccessError,
  AtelierReportAccessError,
  authorizeAgentPactReport,
  authorizeAtelierReport,
  renderAgentPactReport,
  renderAtelierReport,
} from "./lib/atelier-report.mjs";
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
const CANONICAL_ORIGIN = "https://argonaut-bounty-signal.vercel.app";
const INDEXNOW_KEY = "4ca1b627c7308a53827702b294a67590";
const SERVICE_VERSION = "0.5.0";
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
const SAMPLE_CHECK = Object.freeze({
  static_sample: true,
  input: "https://github.com/electron/electron/issues/48191",
  verdict: "reject",
  score: 0,
  reasons: ["canonical_issue_closed", "existing_competition"],
  evidence: {
    canonical_issue_state: "closed",
    competing_pull_requests: 12,
    note: "Illustrative response shape only; buy a live check for current evidence.",
  },
  paid_endpoint: `${CANONICAL_ORIGIN}/api/v1/check`,
  price: PRICE,
  network: NETWORK,
});

function renderLandingPage() {
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ArgonautWorks Bounty Signal",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    description: SERVICE_DESCRIPTION,
    url: CANONICAL_ORIGIN,
    codeRepository: PUBLIC_SOURCE,
    offers: {
      "@type": "Offer",
      price: "0.01",
      priceCurrency: "USD",
      description: "One live GitHub bounty viability check, settled in USDC on Base via x402.",
    },
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GitHub Bounty Checker for AI Agents | Bounty Signal</title>
  <meta name="description" content="Check whether a GitHub bounty is open, funded, uncontested, and worth pursuing before an autonomous coding agent starts work. One cent via x402 on Base.">
  <link rel="canonical" href="${CANONICAL_ORIGIN}/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Bounty Signal — don't code stale bounties">
  <meta property="og:description" content="Live GitHub issue, payout, assignment, claim, repository, and competing-PR evidence for autonomous coding agents.">
  <meta property="og:url" content="${CANONICAL_ORIGIN}/">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${structuredData}</script>
  <style>
    :root{color-scheme:dark;--bg:#090b10;--panel:#11151d;--line:#273041;--text:#f5f7fb;--muted:#a8b1c1;--accent:#79f2c0;--warn:#ffca6a;--danger:#ff7d8c}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 72% 0,#17293a 0,transparent 34rem),var(--bg);color:var(--text);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{width:min(1080px,calc(100% - 40px));margin:auto}header{display:flex;align-items:center;justify-content:space-between;padding:24px 0}.brand{display:flex;align-items:center;gap:10px;color:var(--text);font-weight:750;text-decoration:none}.mark{display:grid;place-items:center;width:34px;height:34px;border:1px solid var(--line);border-radius:10px;background:#171b24}.nav{display:flex;gap:18px}.nav a{color:var(--muted);text-decoration:none;font-size:14px}.nav a:hover{color:var(--text)}main{padding:78px 0 90px}.hero{display:grid;grid-template-columns:1.16fr .84fr;gap:58px;align-items:center}.eyebrow{display:inline-flex;gap:8px;align-items:center;color:var(--accent);font:700 12px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.12em;text-transform:uppercase}.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 16px var(--accent)}h1{max-width:760px;margin:18px 0 22px;font-size:clamp(44px,7vw,78px);line-height:.98;letter-spacing:-.055em}.lede{max-width:670px;color:var(--muted);font-size:19px}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}.btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 17px;border:1px solid var(--line);border-radius:10px;color:var(--text);text-decoration:none;font-weight:700}.btn.primary{border-color:var(--accent);background:var(--accent);color:#07110d}.btn:hover{transform:translateY(-1px)}.price{margin-top:18px;color:var(--muted);font-size:13px}.price strong{color:var(--text)}.card{border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(20,26,36,.96),rgba(12,15,21,.96));box-shadow:0 24px 70px rgba(0,0,0,.3);overflow:hidden}.card-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line);font:700 12px/1 ui-monospace,SFMono-Regular,monospace;color:var(--muted)}.verdict{color:var(--danger)}pre{margin:0;padding:20px;white-space:pre-wrap;overflow:auto;font:13px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;color:#d7deeb}.k{color:#8ab4ff}.s{color:#a8e6c1}.n{color:var(--warn)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:80px}.feature{padding:24px;border:1px solid var(--line);border-radius:14px;background:rgba(17,21,29,.72)}.feature h2{margin:0 0 8px;font-size:17px}.feature p{margin:0;color:var(--muted);font-size:14px}.how{display:grid;grid-template-columns:.85fr 1.15fr;gap:38px;margin-top:80px;align-items:start}.how h2{font-size:34px;line-height:1.1;margin:0 0 14px}.how p{color:var(--muted)}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.snippet{padding:20px;border:1px solid var(--line);border-radius:14px;background:#07090d;overflow:auto;color:#cce7da;font-size:13px}.proof{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.pill{padding:6px 9px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px}footer{border-top:1px solid var(--line);padding:24px 0 42px;color:var(--muted);font-size:13px}.foot{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.foot a{color:var(--muted)}@media(max-width:800px){main{padding-top:40px}.hero,.how{grid-template-columns:1fr}.hero{gap:36px}.grid{grid-template-columns:1fr;margin-top:58px}.nav{display:none}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/"><span class="mark">A</span> ArgonautWorks</a>
      <nav class="nav"><a href="#evidence">Evidence</a><a href="#use">Use the API</a><a href="${PUBLIC_SOURCE}">Source</a></nav>
    </header>
    <main>
      <section class="hero">
        <div>
          <span class="eyebrow"><span class="dot"></span>Live GitHub due diligence</span>
          <h1>Don't code a stale bounty.</h1>
          <p class="lede">Bounty Signal checks the canonical issue, repository, payout evidence, assignments, claims, and competing pull requests before your coding agent spends hours on the wrong job.</p>
          <div class="actions">
            <a class="btn primary" href="/api/v1/sample">View a sample verdict</a>
            <a class="btn" href="/api/v1/check?url=https%3A%2F%2Fgithub.com%2Felectron%2Felectron%2Fissues%2F48191">Inspect the x402 challenge</a>
          </div>
          <p class="price"><strong>$0.01 USDC</strong> per live check · Base mainnet · no account or API key</p>
        </div>
        <div class="card" aria-label="Sample rejection response">
          <div class="card-head"><span>STATIC RESPONSE SAMPLE</span><span class="verdict">REJECT</span></div>
          <pre>{
  <span class="k">"verdict"</span>: <span class="s">"reject"</span>,
  <span class="k">"score"</span>: <span class="n">0</span>,
  <span class="k">"reasons"</span>: [
    <span class="s">"canonical_issue_closed"</span>,
    <span class="s">"existing_competition"</span>
  ],
  <span class="k">"evidence"</span>: {
    <span class="k">"competing_pull_requests"</span>: <span class="n">12</span>
  }
}</pre>
        </div>
      </section>
      <section class="grid" id="evidence">
        <article class="feature"><h2>Canonical state</h2><p>Reject closed, assigned, stale, or crowded issues using current first-party GitHub evidence.</p></article>
        <article class="feature"><h2>Payout reality</h2><p>Separate explicit payment evidence from labels, wishful comments, mirrors, and unsupported headlines.</p></article>
        <article class="feature"><h2>Agent-ready output</h2><p>Receive a verdict, score, reasons, and evidence as deterministic JSON for automated go/no-go decisions.</p></article>
      </section>
      <section class="how" id="use">
        <div>
          <span class="eyebrow">Installable workflow</span>
          <h2>Add the check to your coding agent.</h2>
          <p>The buyer workflow validates the canonical issue URL and exact Base-USDC challenge before signing. Your existing wallet and spend policy remain in control.</p>
          <div class="proof"><span class="pill">x402 v2</span><span class="pill">OpenAPI 3.1</span><span class="pill">A2A 0.3</span><span class="pill">MIT source</span></div>
        </div>
        <div class="snippet"><code>npx skills add ArgonautWorks/bounty-signal-api --skill bounty-signal

GET ${CANONICAL_ORIGIN}/api/v1/check
  ?url=https://github.com/{owner}/{repo}/issues/{number}</code></div>
      </section>
    </main>
    <footer><div class="foot"><span>ArgonautWorks Bounty Signal</span><span><a href="/openapi.json">OpenAPI</a> · <a href="/.well-known/x402">x402 manifest</a> · <a href="/.well-known/agent-card.json">Agent Card</a> · <a href="${PUBLIC_SOURCE}">GitHub</a></span></div></footer>
  </div>
</body>
</html>`;
}

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

app.get("/", (request, response) => {
  if (/\btext\/html\b/i.test(request.get("accept") ?? "")) {
    response
      .set("vary", "accept")
      .set("cache-control", "public, max-age=300")
      .type("text/html")
      .send(renderLandingPage());
    return;
  }
  response.set("vary", "accept").json({
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
    agent_card: "/.well-known/agent-card.json",
    a2a: "/a2a",
    x402_manifest: "/.well-known/x402",
    sample: "/api/v1/sample",
    source: PUBLIC_SOURCE,
  });
});

app.get("/api/v1/sample", (_request, response) => {
  response.set("cache-control", "public, max-age=86400").json(SAMPLE_CHECK);
});

app.get("/robots.txt", (_request, response) => {
  response.type("text/plain").send([
    "User-agent: *",
    "Allow: /",
    `Sitemap: ${CANONICAL_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n"));
});

app.get("/sitemap.xml", (_request, response) => {
  const urls = ["/", "/api/v1/sample", "/openapi.json", "/llms.txt", "/.well-known/agent-card.json"];
  response.type("application/xml").send([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${CANONICAL_ORIGIN}${url}</loc></url>`),
    "</urlset>",
  ].join("\n"));
});

app.get(`/${INDEXNOW_KEY}.txt`, (_request, response) => {
  response.type("text/plain").send(INDEXNOW_KEY);
});

app.get(["/.well-known/agent.json", "/.well-known/agent-card.json"], (request, response) => {
  const origin = `${request.protocol}://${request.get("host")}`;
  const a2aUrl = `${origin}/a2a`;
  response.json({
    protocolVersion: "0.3",
    name: "ArgonautWorks Bounty Signal",
    description: "Autonomous due-diligence tools and evidence products that help agents avoid wasting time on stale, fake, crowded, or unfunded work.",
    url: a2aUrl,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url: a2aUrl, transport: "JSONRPC" }],
    version: SERVICE_VERSION,
    provider: {
      organization: "ArgonautWorks",
      url: PUBLIC_SOURCE,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    documentationUrl: `${origin}/openapi.json`,
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "bounty-signal",
        name: "Check GitHub Bounty Viability",
        description: "Return an evidence-backed viability verdict before committing implementation time to a public GitHub bounty.",
        tags: ["github", "bounties", "due-diligence", "x402"],
        examples: ["How can I check whether a GitHub bounty is worth pursuing?"],
      },
      {
        id: "schedule-fit",
        name: "Find Meeting Overlap",
        description: "Compute practical meeting windows across time zones from a structured request.",
        tags: ["scheduling", "time-zones", "agents", "x402"],
        examples: ["Where do New York and Berlin business hours overlap?"],
      },
      {
        id: "bounty-reality-check",
        name: "Buy Agent Bounty Reality Check",
        description: "Download a dated screen of 1,291 bounty listings, verified false leads, delivery evidence, and a reusable triage policy.",
        tags: ["bounties", "research", "market-data", "x402"],
        examples: ["Where can I get the current Agent Bounty Reality Check?"],
      },
    ],
  });
});

app.post("/a2a", (request, response) => {
  const body = request.body;
  const requestId = body?.id ?? null;

  if (!body || body.jsonrpc !== "2.0" || !["message/send", "SendMessage"].includes(body.method)) {
    response.status(200).json({
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: body?.method ? -32601 : -32600,
        message: body?.method ? "Method not found" : "Invalid Request",
      },
    });
    return;
  }

  const origin = `${request.protocol}://${request.get("host")}`;
  const incoming = body.params?.message;
  const contextId = incoming?.contextId ?? randomUUID();
  const taskId = incoming?.taskId ?? randomUUID();
  const history = incoming && typeof incoming === "object"
    ? [{ ...incoming, kind: "message", contextId, taskId }]
    : [];

  response.json({
    jsonrpc: "2.0",
    id: requestId,
    result: {
      contextId,
      history,
      id: taskId,
      kind: "task",
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
        message: {
          kind: "message",
          messageId: randomUUID(),
          role: "agent",
          parts: [{
            kind: "text",
            text: [
              "ArgonautWorks provides three machine-buyable tools:",
              `(1) check GitHub bounty viability at ${origin}/api/v1/check,`,
              "(2) calculate cross-time-zone meeting overlap at https://argonaut-schedule-fit.vercel.app/api/v1/overlap,",
              `(3) download the Agent Bounty Reality Check at ${origin}/api/v1/report.`,
              `Read ${origin}/openapi.json and ${origin}/.well-known/x402 for exact inputs and Base-USDC x402 prices.`,
            ].join(" "),
          }],
        },
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
      "/api/v1/sample": {
        get: {
          operationId: "getBountyCheckSample",
          summary: "View a static example of the paid response schema",
          responses: {
            200: {
              description: "Static, explicitly non-live example verdict",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
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
    "Free static response sample: GET /api/v1/sample (illustrative, not a live check)",
    "Marketplace-compatible endpoint: POST /api/v1/check with JSON {\"url\":\"https://github.com/{owner}/{repo}/issues/{number}\"}",
    `Price: ${PRICE} USDC on Base via x402 v2`,
    `Paid report: GET /api/v1/report?edition=${REPORT_EDITION} or POST /api/v1/report with JSON {\"edition\":\"${REPORT_EDITION}\"}`,
    `Direct report price: ${DIRECT_REPORT_PRICE} USDC on Base via x402 v2`,
    "OpenAPI: /openapi.json",
    "A2A agent card: /.well-known/agent-card.json (legacy alias: /.well-known/agent.json)",
    "A2A JSON-RPC endpoint: POST /a2a",
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

app.get("/api/v1/atelier-report", async (request, response) => {
  try {
    const access = await authorizeAtelierReport(request.query, PAY_TO);
    const cached = cache.get(access.target.canonicalUrl);
    const cacheHit = cached && Date.now() - cached.createdAt < CACHE_TTL_MS;
    const result = cacheHit ? cached.value : await evaluateGitHubBounty(access.target.canonicalUrl);
    if (!cacheHit) cache.set(access.target.canonicalUrl, { createdAt: Date.now(), value: result });
    response
      .type("text/html")
      .set("cache-control", "private, max-age=300")
      .set("x-robots-tag", "noindex, nofollow")
      .send(renderAtelierReport(result, access.orderId));
  } catch (error) {
    if (error instanceof AtelierReportAccessError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unable to evaluate bounty";
    const status = /must (?:be|use|match)|valid GitHub issue URL/.test(message) ? 400 : 502;
    response.status(status).json({ error: message });
  }
});

app.get("/api/v1/agentpact-report", async (request, response) => {
  try {
    const access = await authorizeAgentPactReport(request.query, PAY_TO);
    const cached = cache.get(access.target.canonicalUrl);
    const cacheHit = cached && Date.now() - cached.createdAt < CACHE_TTL_MS;
    const result = cacheHit ? cached.value : await evaluateGitHubBounty(access.target.canonicalUrl);
    if (!cacheHit) cache.set(access.target.canonicalUrl, { createdAt: Date.now(), value: result });
    response
      .type("text/html")
      .set("cache-control", "private, max-age=300")
      .set("x-robots-tag", "noindex, nofollow")
      .send(renderAgentPactReport(result, access.dealId));
  } catch (error) {
    if (error instanceof AgentPactReportAccessError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unable to evaluate bounty";
    const status = /must (?:be|use|match)|valid GitHub issue URL/.test(message) ? 400 : 502;
    response.status(status).json({ error: message });
  }
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
