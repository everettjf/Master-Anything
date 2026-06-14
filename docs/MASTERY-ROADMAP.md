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
change behavior." **Next:** richer/LLM-proposed inputs and captured-run I/O for
deeper coverage; per-property invariants.

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

**Next:** Understand/Analyze/Create rungs (not just Apply); leaderboards across
models; a web panel; certify a PR's agent before merge.
