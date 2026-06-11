# Mastery roadmap: from "verifiable on the lucky slice" to "verifiably master anything"

This is the plan for the next fundamental leaps. The honest gap today: three
load-bearing claims are thinner than they sound, and closing them — in order —
is what turns the tagline into reality.

| Gap (today)                                                                 | Thrust |
| --------------------------------------------------------------------------- | ------ |
| "Verifiable Apply" only fires where a pre-existing test covers one function | **A** Universal verification |
| The "mastery graph" is a flat per-unit FSM; it doesn't model or adapt       | **B** Knowledge tracing |
| No reason-to-open: mastery isn't tied to a real outcome the user wants      | **C** Goal-anchored Quests |

## A — Universal verification (in progress)

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

**Next in A:**
- LLM-proposed inputs (when a model is configured) for domain-specific coverage,
  still falling back to the deterministic battery offline.
- Captured-run characterization: trace the repo's own examples/entrypoint to
  harvest *real* I/O at function boundaries (grounded, not just fuzzed).
- `pytest.approx` / float tolerance for numeric returns; opt-in keeping of
  error-raising cases; ESM-`.js` and constructor-args support.

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

## C — Goal-anchored Quests (after B)

"I want to fix bug Y / add feature X / understand auth." Compute the required
sub-graph, sequence mastery of exactly those units, and culminate in a real
Create/Apply task on the target — the passing change is the ultimate
verification, and the reason to open the tool at all.
