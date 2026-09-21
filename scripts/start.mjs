#!/usr/bin/env node
/**
 * Production entrypoint for the whole Sales Engine, as one deployment.
 *
 *   uvicorn      the quote module, bound to 127.0.0.1 only — never public.
 *   next start    the workspace, bound to $PORT — the only thing exposed.
 *
 * The workspace proxies the module (see next.config.ts), so from outside there
 * is one service, one URL and one log stream. Python cannot run inside Node, so
 * there are still two processes in the container; nothing outside depends on
 * that, and this script makes them behave as one: if either dies, the container
 * dies, so the platform restarts a whole healthy instance instead of leaving a
 * half-working one serving a broken Quote Ready page.
 *
 * Mirrors scripts/dev.mjs, which does the same for local development.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleDir = path.join(root, "modules", "guided-selling");

const PORT = process.env.PORT ?? "3000";

// QUOTE_WORKSPACE_URL is the single source of truth for where the module lives.
// next.config.ts bakes it into the proxy rules at build time, so the module has
// to listen on exactly that port — deriving the port from the URL is what makes
// the two impossible to disagree. (Setting a separate MODULE_PORT was the bug
// this replaces: a runtime port that differed from the baked URL turned every
// proxied path into a 500 with nothing in the logs to explain it.)
const MODULE_URL = process.env.QUOTE_WORKSPACE_URL ?? "http://127.0.0.1:8001";
process.env.QUOTE_WORKSPACE_URL = MODULE_URL;
const MODULE_PORT = (() => {
  try {
    return new URL(MODULE_URL).port || "8001";
  } catch {
    process.stderr.write(`[start]     QUOTE_WORKSPACE_URL is not a valid URL: ${MODULE_URL}\n`);
    process.exit(1);
  }
})();

const children = [];
let shuttingDown = false;

function run(name, cmd, args, opts = {}) {
  // `detached` puts each child in its own process group so shutdown can signal
  // the whole group. Without it a wrapper process (npx, a venv shim) swallows
  // the signal and the real server keeps its port — which is exactly what
  // happened in testing: the supervisor exited and next-server lived on.
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, ...opts });
  const tag = `[${name}]`.padEnd(11);
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        out.write(`${tag} ${buf.slice(0, i)}\n`);
        buf = buf.slice(i + 1);
      }
    });
  }
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // One half down means the product is broken. Take the container with it.
    process.stderr.write(`${tag} exited (code ${code}, signal ${signal}) — stopping the container so it restarts clean\n`);
    shutdown(code ?? 1);
  });
  child.on("error", (err) => {
    if (shuttingDown) return;
    process.stderr.write(`${tag} failed to start: ${err.message}\n`);
    shutdown(1);
  });
  children.push(child);
  return child;
}

function stop(child, signal) {
  try {
    process.kill(-child.pid, signal); // negative pid = the whole process group
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (c.pid && !c.killed) stop(c, "SIGTERM");
  // Anything still holding its port after the grace period goes the hard way,
  // so a restart never races a stale listener.
  setTimeout(() => {
    for (const c of children) if (c.pid) stop(c, "SIGKILL");
    process.exit(code);
  }, 1500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!existsSync(moduleDir)) {
  process.stderr.write("[start]     modules/guided-selling is missing — refusing to start a half-product\n");
  process.exit(1);
}

// 1. Quote module, loopback only. In the container its dependencies are on the
// system interpreter; a local .venv (how the module is run in development) is
// preferred when present, so this script behaves the same in both places.
const venvUvicorn = path.join(moduleDir, ".venv", "bin", "uvicorn");
const [moduleCmd, moduleArgs] = existsSync(venvUvicorn)
  ? [venvUvicorn, []]
  : [process.env.PYTHON_BIN ?? "python3", ["-m", "uvicorn"]];
run("module", moduleCmd, [...moduleArgs, "app.main:app", "--host", "127.0.0.1", "--port", MODULE_PORT], {
  cwd: moduleDir,
  env: process.env,
});

// 2. Workspace, the public listener. The binary directly rather than through
// npx: one less wrapper between this script and the process holding the port.
const nextBin = path.join(root, "node_modules", ".bin", "next");
run("workspace", nextBin, ["start", "--port", PORT, "--hostname", "0.0.0.0"], { cwd: root, env: process.env });
