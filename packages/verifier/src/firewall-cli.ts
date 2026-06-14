#!/usr/bin/env node
/**
 * Behavioral Firewall CLI — a regression safety net for edits to untested code.
 *
 *   snapshot a file's behavior:   ma-firewall snapshot <file> [-o snapshot.json]
 *   verify an edit preserved it:  ma-firewall verify   <file> <snapshot.json>
 *
 * Typical flow: snapshot the original, let an AI (or anyone) rewrite the file,
 * then verify — it proves behavior is preserved, or reports the exact
 * (function, input) that changed and old→new value. Exit code is non-zero when
 * behavior changed, so it drops straight into CI / an agent loop.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { verifierForExtension } from "./breakfix.js";
import { type BehaviorDiff, type BehaviorSnapshot, snapshotFile, verifyAgainstSnapshot } from "./snapshot.js";

function languageOf(file: string) {
  const v = verifierForExtension(extname(file));
  if (!v) throw new Error(`unsupported file type: ${extname(file)} (Python / JS / TS only)`);
  return v.language;
}

/** Render a stored literal arg-list as a call: "[12, -1, 7]" -> "(12, -1, 7)". */
function callArgs(symbol: string, args: string): string {
  const inner = args.trim().replace(/^\[/, "").replace(/\]$/, "");
  const parts = symbol.split(".");
  const head = parts.length === 2 ? `${parts[0]}().${parts[1]}` : parts[0];
  return `${head}(${inner})`;
}

async function doSnapshot(file: string, out?: string) {
  const abs = resolve(file);
  const language = languageOf(abs);
  const snap = await snapshotFile({ repoRoot: dirname(abs), file: basename(abs), language });
  if (!snap) {
    console.error(`✗ nothing to snapshot in ${file} (no deterministic, literal-returning functions found)`);
    process.exit(2);
  }
  const cases = snap.symbols.reduce((n, s) => n + s.cases.length, 0);
  const dest = out ?? `${abs}.behavior.json`;
  writeFileSync(dest, JSON.stringify(snap, null, 2));
  console.log(
    `✓ snapshot: ${snap.symbols.length} function${snap.symbols.length > 1 ? "s" : ""}, ` +
      `${cases} behavior${cases > 1 ? "s" : ""} pinned → ${dest}`,
  );
  for (const s of snap.symbols) console.log(`    ${s.symbol}  (${s.cases.length})`);
}

function report(diff: BehaviorDiff, file: string) {
  if (diff.ok) {
    console.log(
      `✅ behavior preserved — ${diff.preserved}/${diff.totalCases} behaviors unchanged in ${file}`,
    );
    return;
  }
  console.log(`❌ behavior CHANGED in ${file}`);
  if (diff.changed.length) {
    console.log(`\n  ${diff.changed.length} behavior(s) differ:`);
    for (const c of diff.changed) {
      console.log(`    ${callArgs(c.symbol, c.args)}`);
      console.log(`        was  ${c.expected}`);
      console.log(`        now  ${c.actual}`);
    }
  }
  if (diff.errored.length) {
    console.log(`\n  ${diff.errored.length} behavior(s) now raise an error:`);
    for (const c of diff.errored) console.log(`    ${callArgs(c.symbol, c.args)}  (was ${c.expected})`);
  }
  if (diff.missing.length) {
    console.log(`\n  ${diff.missing.length} function(s) missing / no longer callable:`);
    for (const m of diff.missing) console.log(`    ${m}`);
  }
}

async function doVerify(file: string, snapPath: string) {
  const abs = resolve(file);
  const language = languageOf(abs);
  const snapshot = JSON.parse(readFileSync(resolve(snapPath), "utf8")) as BehaviorSnapshot;
  const candidate = readFileSync(abs, "utf8");
  const diff = await verifyAgainstSnapshot({
    repoRoot: dirname(abs),
    file: basename(abs),
    language,
    snapshot,
    candidate,
  });
  report(diff, file);
  process.exit(diff.ok ? 0 : 1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "snapshot" && rest[0]) {
    const oi = rest.indexOf("-o");
    await doSnapshot(rest[0], oi >= 0 ? rest[oi + 1] : undefined);
  } else if (cmd === "verify" && rest[0] && rest[1]) {
    await doVerify(rest[0], rest[1]);
  } else {
    console.error(
      "usage:\n  ma-firewall snapshot <file> [-o snapshot.json]\n  ma-firewall verify <file> <snapshot.json>",
    );
    process.exit(64);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
