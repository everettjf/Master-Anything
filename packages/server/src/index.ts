/**
 * Dev / standalone API entry: serves the routes at the root path on PORT
 * (default 8787). The web app's vite dev server proxies /api here.
 *
 * For the single-port "npx master-anything" experience (API under /api + the
 * built UI), see serve.ts.
 */
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { runnerDescribe } from "./mastery-store.js";
import { embedDescribe, llmDescribe, providersAvailable } from "./store.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@ma/server listening on http://localhost:${info.port}`);
  console.log(`  LLM enrichment: ${llmDescribe()}`);
  console.log(`  Embeddings:     ${embedDescribe}`);
  console.log(`  Provider keys:  ${providersAvailable()}`);
  runnerDescribe().then((d) => console.log(`  Test sandbox:   ${d}`));
});
