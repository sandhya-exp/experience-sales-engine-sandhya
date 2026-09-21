#!/usr/bin/env node
/**
 * One command for the whole Sales Engine in development:
 *   npm run dev        → Lead & Deal Workspace (Next.js, :3000) + Guided Selling module (FastAPI, :8001)
 *   npm run dev:web    → workspace only
 *
 * The module's port and shared key come from .env.local (QUOTE_WORKSPACE_URL, HANDOFF_API_KEY).
 * Ctrl+C stops both.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleDir = path.join(root, "modules", "guided-selling");

// Minimal .env.local reader (no dependency): KEY=value lines, quotes optional.
const env = { ...process.env };
for (const file of [".env", ".env.local"]) {
  const p = path.join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    if (!(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const modulePort = (() => {
  try {
    return new URL(env.QUOTE_WORKSPACE_URL ?? "http://127.0.0.1:8001").port || "8001";
  } catch {
    return "8001";
  }
})();

const children = [];
function run(name, cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  const tag = `[${name}]`.padEnd(11);
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        out.write(`${tag} ${buf.slice(0, i)}\n`);
        buf = buf.slice(i + 1);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      process.stdout.write(`${tag} exited with code ${code}\n`);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) if (!c.killed) c.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 1. Guided Selling module (Sadhana's FastAPI app), if present.
if (existsSync(moduleDir)) {
  const venvBin = path.join(moduleDir, ".venv", process.platform === "win32" ? "Scripts" : "bin");
  const venvUvicorn = path.join(venvBin, process.platform === "win32" ? "uvicorn.exe" : "uvicorn");
  const uvicorn = existsSync(venvUvicorn) ? venvUvicorn : "uvicorn";
  const dist = path.join(moduleDir, "frontend", "dist", "index.html");
  if (!existsSync(dist)) {
    console.warn(
      "[guided]    frontend build missing — run: (cd modules/guided-selling/frontend && npm install && npm run build)"
    );
  }
  if (uvicorn === "uvicorn" && !existsSync(venvUvicorn)) {
    console.warn(
      "[guided]    no .venv found — first time: cd modules/guided-selling && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    );
  }
  run("guided", uvicorn, ["app.main:app", "--port", modulePort], {
    cwd: moduleDir,
    env: { ...env, HANDOFF_API_KEY: env.HANDOFF_API_KEY ?? "" },
  }).on("error", (err) => {
    console.warn(`[guided]    could not start uvicorn (${err.message}); the workspace will run without the module.`);
  });
} else {
  console.warn("[guided]    modules/guided-selling not found — starting the workspace only.");
}

// 2. Lead & Deal Workspace (Next.js).
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
run("workspace", npx, ["next", "dev"], { cwd: root, env });
