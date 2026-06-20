# Grounded characterization — three ways to make an untested function verifiable

> A progress note on [Master-Anything](https://github.com/everettjf/Master-Anything): an open-source tool that turns any
> codebase (or docs, or a PDF) into a knowledge graph, then uses **real tests** and **graph truth** to **prove** you've
> mastered it. This release is about the *inputs* — making the characterization oracle work on real code, not just the
> functions a fuzzer happens to reach.

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

A while ago we [closed the biggest hole](./blog-universal-verification.html) in "verifiable Apply": you don't *need* a
hand-written test, because an untouched function is its own oracle. Feed the original a battery of inputs, record the
outputs as golden values, synthesize a characterization test — blank the function and that test goes red. Same machinery,
pointed at AI edits, became the [Behavioral Firewall](./blog-behavioral-firewall.html).

But there was an honest catch hiding *inside* that one. The battery only fuzzes **primitives and small collections**:
`0`, `2.5`, `"ab"`, `[1, 2, 3]`. That covers arithmetic-shaped functions. It does **not** cover the function that takes a
config dict, a nested order, a domain object — exactly the functions that make up most real code. For those, the oracle
found nothing, and "verifiable" quietly fell back to "self-check."

This release fixes that by giving the oracle two new ways to get inputs — and keeping the same honest filter on all of them.

## 1. Captured-run I/O — pin the *real* inputs the code already uses

The cleanest source of realistic inputs is the repo itself. Point captured-run at a script your project already ships —
an example, an entrypoint — and Master-Anything **instruments the target module**, runs the script, and records the real
`(arguments → return)` observed at each function boundary.

```bash
npx ma-firewall snapshot src/pricing.py --entry examples/demo.py -o pricing.behavior.json
# ✓ snapshot: 2 functions, 4 behaviors pinned
#     total_price  (2)
#     Cart.line_count  (2)
```

A function taking `{"items": [...], "discount": 0.1}` — which the fuzzer will never construct — becomes verifiable from
how the code is *actually* called. It works for **Python, JavaScript, and TypeScript**, capturing both functions and
methods. (TypeScript's module exports are read-only, so we register a loader that swaps in a generated shim — a top-level
`export function` gets instrumented just like a CommonJS export.) Arguments are snapshotted *before* the call, so even a
function that mutates its input records the correct pre-call value.

How much does it matter on real code? We measured it on two well-known libraries, driven only by examples from their own
docs:

- **[`pytoolz/toolz`](https://github.com/everettjf/Master-Anything/blob/main/docs/casestudy/captured-run-toolz/README.md)** (Python) —
  the firewall went from 4 to 6 functions pinned (27 → 39 behaviors), and `assoc`/`merge` crossed from *unverifiable* to
  *verifiable*.
- **[`object-path`](https://github.com/everettjf/Master-Anything/blob/main/docs/casestudy/captured-run-objectpath/README.md)** (JS) —
  the sharper result. The battery pinned 47 behaviors, but **only 1 of them touched a real object**: things like
  `get(0, 1, 2) -> 2` (the path is a number, so `get` just echoes the default). Those 46 degenerate cases would survive
  almost *any* rewrite of the real path-traversal logic — false confidence. Captured-run added the 15 grounded behaviors
  that pin what `object-path` is actually for.

## 2. LLM-proposed inputs — when there's no driver, ask the model

No example to point at? If you've configured a model, it can **propose** inputs straight from the function's source — a
well-formed record, a couple of edge cases — returned as plain argument-lists. These don't bypass anything: they run
through the *exact same* round-trip + two-run-stable filter as the battery, so a wrong guess simply produces no case. The
model widens coverage; the oracle still decides what's real.

Offline, none of this runs and the battery stands alone — the same honest degradation Master-Anything has always had.

## Why it's the same idea three times

The point of characterization was never the fuzzer — it was the **oracle**: the original code, deciding what's true.
This release just gives that oracle better questions to ask. A deterministic battery for free, real I/O when the repo can
drive it, model-proposed inputs when it can't — and every one of them filtered the same way, so the verdict stays
objective no matter where the input came from.

## Try it

- **Repo:** <https://github.com/everettjf/Master-Anything>
- **The oracle it builds on:** [Making "verifiable" reach any function](./blog-universal-verification.html)
- **The firewall it powers:** [Let an AI rewrite your untested code — and prove it didn't change behavior](./blog-behavioral-firewall.html)

Find the most load-bearing, least-tested file in your repo. Point `ma-firewall` at one of your example scripts with
`--entry`. Watch it pin the behaviors that actually matter — then let an agent rewrite the file and tell you, to the
input, whether you can still trust it.
