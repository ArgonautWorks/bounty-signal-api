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
    assert.equal(document.info.version, "0.2.0");
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
    assert.equal(health.version, "0.2.0");
  });
});

test("A2A agent card exposes the live paid products", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/.well-known/agent.json`);
    assert.equal(response.status, 200);
    const card = await response.json();

    assert.equal(card.name, "ArgonautWorks");
    assert.equal(card.url, origin);
    assert.equal(card.version, "0.2.0");
    assert.deepEqual(card.capabilities, { streaming: false, pushNotifications: false });
    assert.equal(card.documentation.openapi, `${origin}/openapi.json`);
    assert.deepEqual(card.skills.map(({ id }) => id), [
      "bounty-signal",
      "schedule-fit",
      "bounty-reality-check",
    ]);
    assert.equal(card.skills[0].uri, `${origin}/api/v1/check`);
    assert.equal(card.skills[2].uri, `${origin}/api/v1/report`);
    assert.deepEqual(card.skills[0].security, ["x402"]);
    assert.equal(card.securitySchemes.x402.type, "x402");
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
