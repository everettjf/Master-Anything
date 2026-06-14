/**
 * Bundle the Behavioral Firewall CLI into a single, dependency-free executable.
 *
 * The firewall code (in @ma/verifier) uses only Node builtins, so esbuild can
 * inline it into one self-contained ESM file with a shebang — ready for `npx
 * ma-firewall` or a plain `node dist/ma-firewall.mjs`, with nothing to install.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../verifier/src/firewall-cli.ts");
const outfile = resolve(here, "dist/ma-firewall.mjs");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  // Node builtins stay external automatically with platform:node; the firewall
  // has no third-party runtime deps, so the bundle is fully self-contained. The
  // entry's `#!/usr/bin/env node` shebang is preserved by esbuild at the top.
  legalComments: "none",
});

console.log(`✓ bundled → ${outfile}`);
