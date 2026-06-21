/**
 * Build the one-command app: `npx master-anything`.
 *
 * Produces a self-contained launcher that serves the API under /api and the
 * built web UI on a single port. Strategy mirrors the firewall bundle:
 *   - esbuild inlines @ma/server + @ma/core + @ma/verifier + hono + the AI SDK
 *     into one ESM file;
 *   - the native modules (better-sqlite3 + the tree-sitter grammars) stay
 *     external and are declared as real runtime `dependencies`, so npm/npx
 *     installs prebuilt binaries for the user's platform;
 *   - the compiled web SPA is copied next to the bundle as ./web.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const dist = resolve(here, "dist");
const run = (cmd) => execSync(cmd, { cwd: repo, stdio: "inherit" });

// 1. Compile the workspace libs the bundle pulls in (esbuild reads their dist),
//    and build the web UI.
run("pnpm --filter @ma/core --filter @ma/verifier build");
run("pnpm --filter @ma/web build");

// 2. Fresh dist, with the built SPA copied beside the bundle.
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(repo, "packages/web/dist"), resolve(dist, "web"), { recursive: true });

// 3. Bundle the single-port server. Native deps stay external (see header).
const external = [
  "better-sqlite3",
  "tree-sitter",
  "tree-sitter-javascript",
  "tree-sitter-python",
  "tree-sitter-typescript",
];
await build({
  entryPoints: [resolve(repo, "packages/server/src/serve.ts")],
  outfile: resolve(dist, "master-anything.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external,
  // The AI SDK pulls in CJS deps that do dynamic require()s; in an ESM bundle
  // esbuild's require shim throws unless a real `require` is in scope. Inject
  // one (and the shebang) at the very top.
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __maCreateRequire } from 'node:module';",
      "const require = __maCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  legalComments: "none",
});

console.log("\n✓ master-anything bundled → packages/app/dist/master-anything.mjs");
console.log("  web UI            → packages/app/dist/web/");
