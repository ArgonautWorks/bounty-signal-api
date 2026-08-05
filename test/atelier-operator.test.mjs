import assert from "node:assert/strict";
import test from "node:test";
import { orderMatchesService } from "../lib/atelier-operator.mjs";

test("matches only an order carrying the exact service id", () => {
  assert.equal(orderMatchesService({ service_id: "svc_report" }, "svc_report"), true);
  assert.equal(orderMatchesService({ service_id: "svc_image" }, "svc_report"), false);
  assert.equal(orderMatchesService({ serviceId: "svc_report" }, "svc_report"), false);
  assert.equal(orderMatchesService({}, "svc_report"), false);
  assert.equal(orderMatchesService({ service_id: "svc_report" }, ""), false);
});
