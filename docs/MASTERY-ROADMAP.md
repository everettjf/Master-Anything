# Mastery roadmap: from "verifiable on the lucky slice" to "verifiably master anything"

The plan was three fundamental leaps — closing the three load-bearing claims that
were thinner than they sounded. **All three have shipped (A→B→C).** This doc
records what each does and what's next within it.

| Gap (was)                                                                   | Thrust | Status |
| --------------------------------------------------------------------------- | ------ | ------ |
| "Verifiable Apply" only fires where a pre-existing test covers one function | **A** Universal verification | ✅ shipped (Py/JS/TS) |
| The "mastery graph" is a flat per-unit FSM; it doesn't model or adapt       | **B** Knowledge tracing | ✅ shipped |
| No reason-to-open: mastery isn't tied to a real outcome the user wants      | **C** Goal-anchored Quests | ✅ shipped |

## A — Universal verification (shipped)

**Idea:** don't *require* a test — *make the oracle*. Run the original function on
a battery of inputs, capture its outputs as golden values, emit a generated
*characterization test*, and verify the learner's reimplementation against it.
Blanking the function breaks the generated test, so any deterministic,
literal-returning function becomes verifiable without a hand-written test.

**Shipped (Python · JavaScript · TypeScript):** [`packages/verifier/src/characterize.ts`](../packages/verifier/src/characterize.ts)
- Resolves module-level functions and methods on zero-arg classes — Python via
  `inspect`; JS (CommonJS `require`) and TS (ESM dynamic `import` under node
  type-stripping) via reflection (`fn.length`, fresh instance per call).
- Fuzzes a primitive/collection input battery; keeps only cases whose return
  value round-trips to a literal (Python `repr`; JS/TS `JSON` +
  `util.isDeepStrictEqual`) **and** is stable across two runs (filters
  nondeterminism / side effects).
- Emits a runner-native test: pytest (`assert ==`) or `node:test`
  (`assert.deepStrictEqual`), invoking a fresh instance exactly as captured.
- Wired into the Apply loop: when the existing suite doesn't cover a function,
  `createApplyAssessment` synthesizes the oracle, confirms it catches the blank,
  and marks the task `verifiedBy: "characterization"`. The synthesized test is
  server-only (it embeds golden outputs) — stripped from the API response.
- Tests: [`test/characterize.test.ts`](../test/characterize.test.ts) + fixtures
  `test/fixtures/{py,js,ts}-uncovered/`.

**Shipped since:** **float tolerance** for numeric returns — the generated test
uses `pytest.approx` (Python) / a relative-tolerance check (JS/TS), and the
Behavioral Firewall's verify compares numbers within `1e-9` relative tolerance.
A correct reimplementation/refactor that reorders float ops (e.g. `x*0.1` →
`x/10`) no longer false-fails, while integer changes (≥1) and real numeric
changes still differ well above tolerance. Tests:
[`test/snapshot.test.ts`](../test/snapshot.test.ts) (firewall, Py + JS) and
[`test/characterize.test.ts`](../test/characterize.test.ts) (approx emission).

**Shipped since:** **captured-run I/O** — instead of *only* fuzzing, run the
repo's own example/entrypoint with the target module instrumented and harvest the
*real* arguments→return observed at each function boundary
([`packages/verifier/src/capture.ts`](../packages/verifier/src/capture.ts)).
Functions whose arguments the synthetic battery can't construct (a config dict, a
nested order, a domain object) become verifiable from real usage. The captured
pairs use the same `{ args, val }` shape, so they merge straight into the
characterization oracle (`characterize({ …, entrypoint })`) and the Behavioral
Firewall (`snapshotFile({ …, entrypoint })` / `ma-firewall snapshot --entry`).
Only deterministic, literal-round-tripping pairs survive, and the driver is run
twice and intersected — same nondeterminism filtering as the battery. Python and
JavaScript capture functions and methods; TypeScript captures methods (ESM
namespace exports are read-only). Tests:
[`test/capture.test.ts`](../test/capture.test.ts) (a nested-dict function is
`null` without a driver, verifiable with one — Py + JS).

**Next in A:**
- LLM-proposed inputs (when a model is configured) for domain-specific coverage,
  still falling back to the deterministic battery offline.
- Capture top-level TypeScript functions (a loader/transform hook, since ESM
  namespace exports can't be reassigned in-process); async-driver capture.
- Opt-in keeping of error-raising cases; ESM-`.js` and constructor-args support.

## B — Knowledge tracing over the graph (shipped)

The per-unit state machine is now backed by a probabilistic belief where evidence
at one unit **propagates along prerequisite edges** — turning the "mastery graph"
into an actual asset rather than a list of levels.

**Shipped:** [`packages/core/src/tracing.ts`](../packages/core/src/tracing.ts)
- **Per-unit BKT posterior** from each unit's own attempts, with slip/guess tuned
  by verifier objectivity (real tests & graph truth are trusted; LLM grading is
  noisier) plus a learning-transition per attempt.
- **Graph propagation:** an iterative noisy-OR diffusion where mastering a unit is
  discounted evidence its prerequisites are mastered too. Only belief *above the
  prior* propagates, so an un-attempted graph stays at the prior (no spurious
  belief). A sparse set of attempts yields a dense belief over the whole graph.
- **`recommendNext()`** ranks the frontier by learning value = readiness × mastery
  gap × downstream unlocks, floating due reviews to the top, with human reasons
  ("Foundational — a good place to start · unlocks 4 units").
- **Wired in:** `beliefsFor` / `recommendFor` in the server; `GET /repos/:id/next`;
  belief attached to `/mastery`; an adaptive **"Next up"** panel + per-unit belief
  bars in the web Learn view.
- Tests: [`test/tracing.test.ts`](../test/tracing.test.ts) (BKT, propagation,
  readiness, frontier advance, review surfacing).

**Next in B:** misconception/cognitive-state modelling; expected-information-gain
selection (not just learning value); decay of belief over time alongside the
spaced-repetition schedule; per-Bloom-level beliefs rather than a single P(mastered).

## C — Goal-anchored Quests (shipped)

"I want to fix bug Y / add feature X / understand auth." A quest anchors that goal
to a target unit, masters *exactly* the required sub-graph, and ends in a real
Apply on the target — the passing change is the ultimate verification, and the
reason to open the tool at all. This closes the A→B→C arc: a quest is pure
orchestration over A (verification), B (beliefs), and the graph.

**Shipped:** [`packages/core/src/quest.ts`](../packages/core/src/quest.ts)
- **`requiredSubgraph()`** — backward closure from the target over prerequisite
  edges, dependency-ordered; unrelated units are excluded (you master *only* what
  the goal needs).
- **Goal → target** via existing retrieval (`unitsForNodes` maps the best-matching
  symbol to its unit); or pick a target unit explicitly. Offline (lexical) by
  default; embeddings/LLM slot in behind the same shape.
- **`questProgress()`** — live percent, the unlocked-or-not **capstone**, and the
  next best step *within the quest* (reusing the B recommender scoped to the
  sub-graph), with `complete`/`capstoneReady` flags.
- **Server:** `createQuest` / `getQuestProgress` / `listQuests`; `POST/GET
  /repos/:id/quests[/:qid]`.
- **Web:** a 🎯 Quest panel in Learn — type a goal, get an ordered checklist with
  belief bars, a highlighted capstone, a live progress bar, and a "next step"
  that opens the right practice. Validated end-to-end on py-calc: 0% → capstone
  unlocked → 100%.
- Tests: [`test/quest.test.ts`](../test/quest.test.ts) (sub-graph closure,
  node→unit mapping, capstone gating, completion).

**Shipped since:** quests now **persist in SQLite** (`quests` table, repo-scoped by
root) — `createQuest` writes through and the store hydrates on boot, so a quest and
its progress survive a server restart (`test/persistence.test.ts`).

**Next in C:** Create-level capstones (ship a new capability, not just reimplement);
multi-target quests from a real issue/PR; LLM-decomposed goals into sub-quests.

## Beyond A→B→C — the Behavioral Firewall (shipped)

A's characterization oracle generalizes past *learning*: the same machinery that
makes an untested function verifiable can guard **AI edits to untested code**.

**Shipped:** [`packages/verifier/src/snapshot.ts`](../packages/verifier/src/snapshot.ts)
- **`snapshotFile()`** discovers every function/zero-arg-class method in a file
  (language-native reflection — no external parser), fuzzes each, and pins its
  deterministic, literal-returning behavior (stable across two runs). Output is a
  portable `BehaviorSnapshot` JSON.
- **`verifyAgainstSnapshot()`** replays the snapshot against a candidate edit and
  returns a precise `BehaviorDiff`: which `(symbol, input)` changed and old→new,
  what now errors, and which functions went missing.
- **CLI** [`firewall-cli.ts`](../packages/verifier/src/firewall-cli.ts):
  `ma-firewall snapshot <file> [-o snap.json]` / `verify <file> <snap.json>` —
  non-zero exit on change, so it drops into CI or an agent loop. Python · JS · TS.
- **Server + web:** `POST /repos/:id/firewall/snapshot|verify`
  ([`firewall.ts`](../packages/server/src/firewall.ts)) and a 🛡 Firewall tab in
  the app ([`Firewall.tsx`](../packages/web/src/Firewall.tsx)) — pick a file,
  snapshot, edit/paste a rewrite, verify, and see the `(function, input)` diffs.
- Tests: [`test/snapshot.test.ts`](../test/snapshot.test.ts) (snapshot,
  behavior-preserving refactor passes, real change caught with exact diff,
  removed function flagged missing — Python + JS).

**The pitch:** "Let an AI rewrite your untested legacy code — and prove it didn't
change behavior."

**Shipped since:** the firewall is now a **standalone, zero-dependency npm CLI** —
[`packages/firewall`](../packages/firewall) (`ma-firewall`), bundled into a single
self-contained file via esbuild, so `npx ma-firewall snapshot|verify` works with
nothing to install. A CI example ([`.github/workflows/firewall.yml`](../.github/workflows/firewall.yml))
pins behavior and fails the build on drift. (The underlying `@ma/verifier` carries
no third-party runtime deps, so the bundle is fully inlined.)

**Shipped since:** captured-run I/O (see thrust A above) — `ma-firewall snapshot
<file> --entry <driver>` runs an example/entrypoint with the file instrumented and
pins the *real* input→output it observes, so functions whose arguments the fuzzer
can't construct are guarded too. Without `--entry`, a file of complex-argument
functions snapshots empty; with it, behavior is captured and a regression is
caught with the exact `(function, input)` and old→new.

**Next:** richer/LLM-proposed inputs for deeper coverage; per-property invariants.

## AI-certification twin (shipped)

The mastery loop, with the learner = an **agent**. For every implementable unit we
blank the function, ask an agent to reimplement it, verify objectively (real tests
/ the characterization oracle), and feed pass/fail into knowledge tracing — a
per-unit **competence profile** of that agent on *this* repo.

**Shipped:** [`packages/server/src/certify.ts`](../packages/server/src/certify.ts)
- `certifyAgent(repo, solve, opts)` — pure orchestration over A + B; the agent is
  an injected `solve(task)` function, so it's testable and pluggable to any model.
- Built-in solvers: the configured **LLM** (the model under test), plus `oracle`
  (submits the reference impl — a perfect baseline that self-tests the exam, and
  works offline) and `lazy` (no-op — a zero baseline / negative control).
- Report: pass rate over gradable units + the **weakest** units (lowest belief),
  i.e. where the agent is shaky on this codebase.
- Endpoint `POST /repos/:id/certify` (`{ agent?: "llm"|"oracle"|"lazy", limit? }`).
- Validated on py-calc: oracle → 100% (6/6), lazy → 0% with a populated weak list.

**Shipped since:** a **cross-agent leaderboard** — `compareAgents` /
`rankReports` run the same exam across several agents (any mix of real models +
the `oracle`/`lazy` baselines) and rank them by pass rate (`POST
/repos/:id/certify/compare`), surfaced as a ranked board in the web Certify panel.
Tests: [`test/certify.test.ts`](../test/certify.test.ts) (ranking + tie-breaks).

**Next:** Understand/Analyze/Create rungs (not just Apply); certify a PR's agent
before merge.
