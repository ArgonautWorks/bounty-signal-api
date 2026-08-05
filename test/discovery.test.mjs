import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import app from "../app.mjs";

async function withServer(run) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("OpenAPI declares the paid route for autonomous discovery", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/openapi.json`);
    assert.equal(response.status, 200);
    const document = await response.json();
    const operation = document.paths["/api/v1/check"].get;

    assert.equal(document.openapi, "3.1.0");
    assert.equal(document.info.version, "0.5.0");
    assert.equal(document.info.contact.url, "https://github.com/ArgonautWorks/bounty-signal-api");
    assert.match(document.info["x-guidance"], /before committing implementation time/);
    assert.deepEqual(operation["x-payment-info"], {
      price: { mode: "fixed", currency: "USD", amount: "0.01" },
      protocols: [{ x402: {} }],
    });
    assert.deepEqual(operation.responses[200].content["application/json"].schema.required, [
      "verdict",
      "score",
      "reasons",
      "evidence",
    ]);
    assert.equal(document.paths["/api/v1/check"].post.operationId, "checkGitHubBountyFromJson");
    assert.deepEqual(
      document.paths["/api/v1/check"].post.requestBody.content["application/json"].schema.required,
      ["url"],
    );
    assert.equal(document.paths["/api/v1/sample"].get.operationId, "getBountyCheckSample");
  });
});

test("serves an indexed HTML landing page without breaking JSON discovery", async () => {
  await withServer(async (origin) => {
    const [htmlResponse, jsonResponse, sampleResponse] = await Promise.all([
      fetch(`${origin}/`, { headers: { accept: "text/html" } }),
      fetch(`${origin}/`, { headers: { accept: "application/json" } }),
      fetch(`${origin}/api/v1/sample`),
    ]);

    assert.match(htmlResponse.headers.get("content-type"), /^text\/html/);
    const html = await htmlResponse.text();
    assert.match(html, /Don't code a stale bounty/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, /rel="canonical"/);

    assert.match(jsonResponse.headers.get("content-type"), /^application\/json/);
    const discovery = await jsonResponse.json();
    assert.equal(discovery.sample, "/api/v1/sample");

    const sample = await sampleResponse.json();
    assert.equal(sample.static_sample, true);
    assert.equal(sample.verdict, "reject");
    assert.match(sample.evidence.note, /Illustrative response shape only/);
  });
});

test("publishes crawler discovery and IndexNow ownership assets", async () => {
  await withServer(async (origin) => {
    const key = "4ca1b627c7308a53827702b294a67590";
    const [robots, sitemap, keyResponse] = await Promise.all([
      fetch(`${origin}/robots.txt`),
      fetch(`${origin}/sitemap.xml`),
      fetch(`${origin}/${key}.txt`),
    ]);

    assert.match(await robots.text(), /Sitemap: https:\/\/argonaut-bounty-signal\.vercel\.app\/sitemap\.xml/);
    assert.match(sitemap.headers.get("content-type"), /application\/xml/);
    const xml = await sitemap.text();
    assert.match(xml, /<loc>https:\/\/argonaut-bounty-signal\.vercel\.app\/<\/loc>/);
    assert.match(xml, /\/api\/v1\/sample/);
    assert.equal(await keyResponse.text(), key);
  });
});

test("crawler identity asset and service version are public", async () => {
  await withServer(async (origin) => {
    const [favicon, health] = await Promise.all([
      fetch(`${origin}/favicon.ico`),
      fetch(`${origin}/health`).then((response) => response.json()),
    ]);

    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(await favicon.text(), /<svg/);
    assert.equal(health.version, "0.5.0");
  });
});

test("A2A agent card declares a JSON-RPC transport and the paid products", async () => {
  await withServer(async (origin) => {
    const [cardResponse, aliasResponse] = await Promise.all([
      fetch(`${origin}/.well-known/agent-card.json`),
      fetch(`${origin}/.well-known/agent.json`),
    ]);
    assert.equal(cardResponse.status, 200);
    assert.equal(aliasResponse.status, 200);
    const card = await cardResponse.json();
    assert.deepEqual(await aliasResponse.json(), card);

    assert.equal(card.name, "ArgonautWorks Bounty Signal");
    assert.equal(card.protocolVersion, "0.3");
    assert.equal(card.url, `${origin}/a2a`);
    assert.equal(card.preferredTransport, "JSONRPC");
    assert.deepEqual(card.additionalInterfaces, [{ url: `${origin}/a2a`, transport: "JSONRPC" }]);
    assert.equal(card.version, "0.5.0");
    assert.deepEqual(card.capabilities, {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    });
    assert.equal(card.documentationUrl, `${origin}/openapi.json`);
    assert.deepEqual(card.defaultInputModes, ["text/plain", "application/json"]);
    assert.deepEqual(card.defaultOutputModes, ["text/plain", "application/json"]);
    assert.deepEqual(card.skills.map(({ id }) => id), [
      "bounty-signal",
      "schedule-fit",
      "bounty-reality-check",
    ]);
    assert.ok(card.skills.every((skill) => skill.tags.includes("x402")));
  });
});

test("A2A message/send returns a completed task with product discovery", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/a2a`, {
      method: "POST",
      headers: { "content-type": "application/json", "a2a-version": "0.3" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "registry-probe",
        method: "message/send",
        params: {
          message: {
            kind: "message",
            messageId: "probe-message",
            role: "user",
            parts: [{ kind: "text", text: "Hello, what can you do?" }],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.jsonrpc, "2.0");
    assert.equal(body.id, "registry-probe");
    assert.equal(body.result.kind, "task");
    assert.equal(body.result.status.state, "completed");
    assert.equal(body.result.status.message.role, "agent");
    assert.match(body.result.status.message.parts[0].text, /GitHub bounty viability/);
    assert.match(body.result.status.message.parts[0].text, /\.well-known\/x402/);
  });
});

test("direct report route exposes a distinct $1.99 x402 challenge", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/v1/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ edition: "2026-08-04" }),
    });
    assert.equal(response.status, 402);
    const challenge = JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64").toString("utf8"));
    assert.equal(challenge.accepts[0].amount, "1990000");
    assert.equal(challenge.resource.mimeType, "text/markdown");
  });
});

test("POST route exposes the same one-cent x402 challenge", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/v1/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/electron/electron/issues/48191" }),
    });
    assert.equal(response.status, 402);
    const challenge = JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64").toString("utf8"));
    assert.equal(challenge.accepts[0].amount, "10000");
  });
});
