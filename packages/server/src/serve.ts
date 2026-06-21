/**
 * Single-port launcher for `npx master-anything`.
 *
 *   - mounts the full API under  /api/*
 *   - serves the pre-built web UI for everything else (SPA fallback to index.html)
 *   - opens the browser (unless --no-open)
 *
 * The web assets ship next to the bundle as ./web (overridable via MA_WEB_DIR).
 * An optional positional <path> pre-connects a repo so the UI lands ready.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { app as api } from "./app.js";
import { embedDescribe, llmDescribe, providersAvailable } from "./store.js";

const HELP = `master-anything — learn any codebase, verifiably.

Usage:
  npx master-anything [path] [options]

Arguments:
  path                 a repo/folder to pre-connect (optional; you can also add
                       it from the UI)

Options:
  -p, --port <n>       port to listen on            (default 8787, or $PORT)
      --no-open        do not open the browser
  -h, --help           show this help

Environment:
  MA_DATA_DIR          where the SQLite DB lives     (default ./.ma-data)
  ANTHROPIC_API_KEY    (or OPENAI_API_KEY, …) enables LLM enrichment; unset is
                       fine — the app falls back to heuristics.
  See .env.example for the full list.
`;

function parseArgs(argv: string[]) {
  const opts = { port: undefined as number | undefined, open: true, path: undefined as string | undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a === "--no-open") {
      opts.open = false;
    } else if (a === "-p" || a === "--port") {
      opts.port = Number(argv[++i]);
    } else if (a.startsWith("--port=")) {
      opts.port = Number(a.slice("--port=".length));
    } else if (!a.startsWith("-") && opts.path === undefined) {
      opts.path = a;
    }
  }
  return opts;
}

// --- static web assets (shipped beside the bundle) --------------------------
const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(process.env.MA_WEB_DIR ?? join(here, "web"));
const indexHtml = join(webDir, "index.html");
const hasWeb = existsSync(indexHtml);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const root = new Hono();
root.route("/api", api);

if (hasWeb) {
  const indexBody = readFileSync(indexHtml);
  root.get("/*", async (c) => {
    const rel = decodeURIComponent(c.req.path).replace(/^\/+/, "") || "index.html";
    const file = resolve(webDir, rel);
    // path-traversal guard + existence check, else fall back to the SPA shell
    if (file.startsWith(webDir) && file !== webDir && existsSync(file)) {
      const body = await readFile(file);
      return c.body(body, 200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    }
    return c.body(indexBody, 200, { "content-type": MIME[".html"] });
  });
} else {
  root.get("/", (c) =>
    c.text("master-anything: web UI not found (expected at ./web). Rebuild the package.", 500),
  );
}

// --- best-effort browser open ----------------------------------------------
function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the printed URL is the fallback */
  }
}

// --- optional pre-connect of a repo ----------------------------------------
async function preconnect(path: string, base: string) {
  try {
    const res = await fetch(`${base}/api/repos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: resolve(path) }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (res.ok && data.id) console.log(`  Pre-connected:  ${resolve(path)} → repo ${data.id}`);
    else console.log(`  Pre-connect failed for ${path}: ${data.error ?? res.status}`);
  } catch (err) {
    console.log(`  Pre-connect failed for ${path}: ${err instanceof Error ? err.message : err}`);
  }
}

const opts = parseArgs(process.argv.slice(2));
const port = opts.port ?? Number(process.env.PORT ?? 8787);

serve({ fetch: root.fetch, port }, async (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`\n  Master-Anything → ${url}\n`);
  console.log(`  LLM enrichment: ${llmDescribe()}`);
  console.log(`  Embeddings:     ${embedDescribe}`);
  console.log(`  Provider keys:  ${providersAvailable()}`);
  if (!hasWeb) console.log("  ⚠ web UI assets missing — API only.");
  if (opts.path) await preconnect(opts.path, url);
  if (opts.open) openBrowser(url);
  console.log("\n  Press Ctrl+C to stop.\n");
});
