# Making "verifiable" reach *any* function — the original code is the oracle

> A progress note on [Master-Anything](https://github.com/everettjf/Master-Anything): an open-source tool that turns any
> codebase (or docs, or a PDF) into a knowledge graph, then uses **real tests** and **graph truth** to **prove** you've
> mastered it. This one is about closing an honest gap: making verifiable **Apply** stop depending on "a test happens to
> exist."

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

The whole pitch of Master-Anything is one word: **verifiable**. You reimplement a blanked function, and the project's
**actual test suite** decides whether you passed — not a language model saying "nice answer," but tests literally turning
green.

Here's the honest catch that lived under that claim for a while: **"verifiable Apply" only worked when a pre-existing
test happened to cover that one function.** In real codebases, most functions aren't so lucky — they have no dedicated
test. For those, the old path degraded to "self-check": you wrote something, and we couldn't objectively tell you whether
it was right. For a tool that calls itself *verifiable*, that's too big a hole.

This release closes it.

## The idea: don't *require* a test — *make* the oracle

The turn is simple: **as long as a function hasn't been touched, it is itself the source of truth (the oracle) for what
it should do.**

So instead of *finding* a test, we *generate* one:

1. Take the **original implementation**, feed it a battery of inputs, and record its outputs as golden values.
2. Use those input → golden pairs to synthesize a **characterization test**.
3. Now blank the function — and that freshly generated test immediately fails.

Just like that, a previously-unverifiable function becomes verifiable: you reimplement it, the characterization test
passes, and you've **objectively** passed. **Any deterministic, literal-returning function no longer needs a hand-written
test.**

The code lives in
[`packages/verifier/src/characterize.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/verifier/src/characterize.ts).

## How we make it *trustworthy*, not just "it runs"

"Use the original code as the oracle" sounds easy, but it only holds up if you sweat the details. We added several gates,
preferring to *skip* a function rather than emit a test that lies:

- **Two-run de-noising.** Each input battery runs twice; we keep only cases whose outputs match **exactly** across both
  runs. This automatically filters out functions that read the clock, use randomness, or have side effects — their
  outputs won't agree, so they're dropped, and we never emit a flaky test.
- **`repr` round-trip filter.** We keep only cases whose return value round-trips through `repr` (i.e. can be asserted as
  a literal). That narrows scope to functions returning simple data — numbers, strings, lists, dicts — exactly the class
  where "assert it equals this concrete value" is rock-solid.
- **Prove the blank breaks it.** Before declaring a function "verifiable," we blank it, run the generated test, and
  confirm the test **actually** catches the blank. A test that still passes when the body is gone is meaningless, so we
  don't accept it.
- **The generated test is server-only.** A characterization test embeds the golden answers — that's the answer key
  written on the exam. So it's never sent to the client; it's stripped from the API response. You only ever see the
  blanked function.

## What it looks like in the product

Open **Learn → a unit → Apply**, and the task now tells you exactly how it's verified, in one of three states:

- **✓ test-verified** — the project already had a test covering this function (always supported).
- **✓ oracle-verified (auto-generated test)** — no existing test, so we used the original implementation as the oracle
  and **synthesized** a characterization test on the spot. **This is the new capability.**
- **⚠ advisory only** — the function genuinely can't be characterized safely (nondeterministic, or needs complex inputs),
  so it's honestly labeled: passing is yours to judge.

In other words: a large class of functions that used to land in bucket three now land in bucket two — truly verifiable.

## Scope, and the honest edges

Credibility beats hype, so let me be precise. What this covers today:

- **Python, JavaScript, and TypeScript** — module-level functions and methods on **zero-arg classes** (the kind you can
  just `Calculator()` into being). Python uses `inspect` + `repr`; JS/TS use reflection + `JSON` round-tripping, run via
  `node:test` (TS through node's built-in type-stripping).
- Inputs drawn from a primitive/collection battery; only **deterministic**, **literal-returning** cases are kept.

What's next (we're going **A → B → C**, and this is step **A**):

- **LLM-proposed inputs** — when a model is configured, let it propose semantically representative inputs; with no model,
  keep falling back to the deterministic battery so it **still works offline**.
- **Captured-run inputs** — run the repo's own examples/entrypoints and harvest *real* I/O at function boundaries, not
  just fuzzed values.

**B** then replaces today's flat per-unit state machine with a **knowledge-tracing** model that propagates evidence along
the graph and drives "what to practice next"; **C** is **goal-anchored Quests**: state the change you want to ship (fix a
bug, add a feature), and the system computes the sub-graph you must master and uses that real change as the ultimate
verification. The full plan lives in
[`docs/MASTERY-ROADMAP.md`](https://github.com/everettjf/Master-Anything/blob/main/docs/MASTERY-ROADMAP.md).

## Try it

- **Repo:** <https://github.com/everettjf/Master-Anything>
- **Getting started:** [Don't just *read* your codebase — *master* it](./blog.html)
- **Site & tutorial:** <https://everettjf.github.io/Master-Anything/>

Pick a function with **no** test covering it, blank it, and write it again. The moment a test you've never seen — one
nobody ever wrote — turns green because of the implementation *you* just typed: that's verifiable mastery, finally done
being a picky eater.
