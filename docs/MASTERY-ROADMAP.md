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

**Shipped (v1, Python):** [`packages/verifier/src/characterize.ts`](../packages/verifier/src/characterize.ts)
- Resolves module-level functions and methods on zero-arg classes (Python `inspect`).
- Fuzzes a primitive/collection input battery; keeps only cases whose return
  value round-trips through `repr` (assertable as a literal) **and** is stable
  across two runs (filters nondeterminism / side effects).
- Wired into the Apply loop: when the existing suite doesn't cover a function,
  `createApplyAssessment` synthesizes the oracle, confirms it catches the blank,
  and marks the task `verifiedBy: "characterization"`. The synthesized test is
  server-only (it embeds golden outputs) — stripped from the API response.
- Tests: [`test/characterize.test.ts`](../test/characterize.test.ts) + fixture
  `test/fixtures/py-uncovered/`.

**Next in A:**
- JS/TS oracle (Node introspection + `node --test` generated spec).
- LLM-proposed inputs (when a model is configured) for domain-specific coverage,
  still falling back to the deterministic battery offline.
- Captured-run characterization: trace the repo's own examples/entrypoint to
  harvest *real* I/O at function boundaries (grounded, not just fuzzed).
- `pytest.approx` for float returns; opt-in keeping of error-raising cases.

## B — Knowledge tracing over the graph (next)

Replace the per-unit state machine with a probabilistic model where evidence at
one unit **propagates along edges** (mastering a dependent is weak evidence for
its prerequisites), models misconceptions, and exposes `nextBestExercise()` that
maximizes expected information at the learner's knowledge frontier. This is what
makes the "mastery graph" an actual asset rather than a list of levels.

## C — Goal-anchored Quests (after B)

"I want to fix bug Y / add feature X / understand auth." Compute the required
sub-graph, sequence mastery of exactly those units, and culminate in a real
Create/Apply task on the target — the passing change is the ultimate
verification, and the reason to open the tool at all.
