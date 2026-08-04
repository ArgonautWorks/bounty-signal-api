import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { DEFAULT_ATELIER_STATE } from "../lib/atelier-operator.mjs";

const statePath = process.env.ATELIER_STATE_FILE ?? DEFAULT_ATELIER_STATE;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

if (!await exists(statePath)) run(process.execPath, ["scripts/register-atelier.mjs"]);
run(process.execPath, ["scripts/configure-atelier-payout.mjs"]);
run(process.execPath, ["scripts/setup-atelier-service.mjs"]);
run("systemctl", ["--user", "enable", "--now", "argonaut-atelier-orders.timer"]);
run("systemctl", ["--user", "disable", "--now", "argonaut-atelier-bootstrap.timer"]);
console.log(JSON.stringify({ atelier_bootstrap: "complete", order_timer: "enabled" }));
