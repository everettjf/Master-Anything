# Your mastery graph just became an asset — adaptive tracing + goal-anchored quests

> A progress note on [Master-Anything](https://github.com/everettjf/Master-Anything): the open-source tool that turns any
> codebase (or docs, or a PDF) into a knowledge graph and uses **real tests** and **graph truth** to **prove** you've
> mastered it. This one ships the last two of three foundational leaps — so the **A→B→C** arc is now complete.

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

A while back I wrote down the three places where Master-Anything's biggest claims were thinner than they sounded, and
the plan to close them in order:

- **A — Universal verification.** "Verifiable Apply" only fired where a pre-existing test happened to cover a function.
  ([shipped — the characterization oracle](./blog-universal-verification.html), now Py/JS/TS.)
- **B — Knowledge tracing.** The "mastery graph" was a flat per-unit state machine: evidence at one unit never moved its
  neighbours. A graph that doesn't propagate isn't really a graph.
- **C — Goal-anchored quests.** There was no *reason to open the tool* — mastery wasn't tied to anything you actually
  wanted to ship.

**B and C are now in.** Here's what changed.

## B — the graph finally propagates

Real understanding isn't independent. Units sit in a prerequisite graph, so evidence at one should inform its
neighbours. Master-Anything now derives a probabilistic belief **P(mastered)** for *every* unit from a sparse set of
attempts, in two steps:

1. **A per-unit posterior** (Bayesian Knowledge Tracing) from each unit's own attempts — with slip/guess tuned by how
   objective the verifier is. Real tests and graph truth are trusted; LLM grading is treated as noisier. Each attempt
   also nudges belief up a little, because practising *teaches*.
2. **Propagation along prerequisite edges.** Mastering a unit is discounted evidence that the things it's built on are
   mastered too — an iterative noisy-OR diffusion across the graph. So a handful of attempts produces a *dense* belief
   over the whole graph, not five isolated numbers.

One engineering detail I'm a little proud of: **only belief *above the prior* propagates.** Without that, an
un-attempted foundational unit would inherit spurious belief just because lots of things sit on top of it. With it, an
untouched graph stays honestly at the prior, and only *real* mastery flows downhill.

From those beliefs, the Learn view now shows an adaptive **"Next up"** panel. It ranks the frontier by **learning value
= readiness × mastery-gap × downstream-unlocks** (with due spaced-repetition reviews floated to the top), each with a
human reason: *"Foundational — a good place to start · unlocks 4 units."* It's all pure, deterministic, offline math
over the graph — no LLM in the loop. `GET /repos/:id/next`.

## C — a reason to open the tool

This is the part that ties everything together. You state a goal — *"fix the averaging bug"*, *"work on auth"* — and
Master-Anything turns it into a **quest**:

1. **Anchor** the goal to a target unit in the graph (via retrieval; offline-lexical by default).
2. **Compute the required sub-graph** — the target plus its *transitive* prerequisites, and *nothing else*. You master
   exactly what the goal needs, in dependency order.
3. **Drive it with the B beliefs** — a live progress bar, an ordered checklist, and the next best step *scoped to the
   quest*.
4. **End on a capstone** — a real Apply on the target unit. The passing change is the ultimate, objective verification.

Here's the actual end-to-end run on the bundled `py-calc`, goal = *"fix the average calculation"* (it anchors to the
`average` unit, whose required sub-graph is `Calculator → average`):

```
fresh   0%    next = Calculator   (Foundational — a good place to start · unlocks 1 unit)   capstone locked
+Calc   50%   next = average      (Prerequisites in place)                                  capstone unlocked
+avg    100%  ✓ complete
```

Master `Calculator`, and the capstone `average` unlocks; master it, and the quest completes — every step gated by real
verification, sequenced by the belief graph. That's the **A→B→C** loop closed: *the thing you set out to do* becomes the
exam, and you only learn the sub-graph it actually requires.

## Honest edges, and what's next

- **B** uses a single P(mastered) per unit; next is per-Bloom-level beliefs, belief decay over time alongside the
  spaced-repetition schedule, and expected-information-gain selection (not just learning value).
- **C** capstones are reimplement-the-target Apply tasks today; next is *Create*-level capstones (ship a genuinely new
  capability), multi-target quests decomposed from a real issue/PR, and persisting quests across sessions.
- It's all deterministic and offline by default; an LLM only ever *improves* anchoring/decomposition, never gates it.

The full design lives in
[`docs/MASTERY-ROADMAP.md`](https://github.com/everettjf/Master-Anything/blob/main/docs/MASTERY-ROADMAP.md), and the
code is small enough to read in a sitting:
[`tracing.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/core/src/tracing.ts) ·
[`quest.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/core/src/quest.ts).

## Try it

- **Repo:** <https://github.com/everettjf/Master-Anything>
- **Part one of the arc:** [Making "verifiable" reach any function](./blog-universal-verification.html)
- **Getting started:** [Don't just *read* your codebase — *master* it](./blog.html)

Point it at a repo, open **Learn**, and type a goal into the 🎯 Quest box. Watch it lay out the exact path, then climb
it — every green check earned against something real, ending on a change you actually wanted to make.
