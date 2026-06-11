# Let an AI rewrite your untested code — and prove it didn't change behavior

> A spin-off from [Master-Anything](https://github.com/everettjf/Master-Anything). The same oracle that makes an untested
> function *learnable* turns out to make AI edits to untested code *trustworthy*. Meet the **Behavioral Firewall**.

![Master-Anything](https://everettjf.github.io/Master-Anything/assets/og.png)

Here's the thing nobody quite says out loud about AI coding agents: they're at their most dangerous on exactly the code
you can least afford them to touch — the **untested** stuff. A test suite is a safety net. Delete the net, and an agent's
"harmless refactor" of some crusty `utils.py` is an act of faith. The diff looks fine. The PR is green (there are no
tests to be red). And you have *no idea* whether `clamp(12, -1, 7)` still returns what it used to.

Master-Anything already builds the missing piece for the *learning* loop: a **characterization oracle** that captures a
function's behavior by running it. Point that same machinery at AI edits and you get a regression net for code that never
had one.

## The idea: snapshot behavior, then verify it survived

Two commands.

**`snapshot`** discovers every function (and zero-arg-class method) in a file — by *reflection*, no parser — runs each
over a battery of inputs, and pins the deterministic results as golden `input → output` pairs:

```
$ ma-firewall snapshot utils.py -o utils.behavior.json
✓ snapshot: 3 functions, 19 behaviors pinned → utils.behavior.json
    clamp  (11)
    running_sum  (4)
    Stats.total  (4)
```

Now let an agent (or a teammate, or yourself at 2am) rewrite the file. **`verify`** replays the snapshot against the new
version. If behavior held, you get a clean bill — and an exit code of 0:

```
$ ma-firewall verify utils.py utils.behavior.json
✅ behavior preserved — 19/19 behaviors unchanged in utils.py
```

And when it *didn't* hold, you don't get a vague "something broke" — you get the exact function, the exact input, and the
exact old→new value, with a non-zero exit:

```
$ ma-firewall verify utils.py utils.behavior.json
❌ behavior CHANGED in utils.py

  3 behavior(s) differ:
    clamp(12, -1, 7)
        was  7
        now  8
    running_sum([1, 2, 3])
        was  [1, 3, 6]
        now  [2, 4, 7]
    running_sum([2, 4, 6])
        was  [2, 6, 12]
        now  [3, 7, 13]
```

That's an off-by-one in a clamp bound and an accumulator that started at the wrong value — caught precisely, on code with
zero hand-written tests.

## Why it doesn't cry wolf

A behavioral guard is worthless if it flags noise. So the firewall is deliberately conservative about what it pins — it
would rather stay silent than raise a false alarm:

- **Only deterministic behavior.** Every input runs twice; anything whose output disagrees across runs (clocks, RNG, I/O,
  global state) is dropped. The firewall never fails because of nondeterminism.
- **Only literal-comparable results.** A value is pinned only if it round-trips to a literal (numbers, strings, lists,
  dicts). Opaque objects aren't asserted, so you don't get spurious "changed" on a reordered repr.
- **Honest about gaps.** A removed or no-longer-callable function is reported as **missing**, not silently passed.

The flip side is the honest limit: the firewall pins the behavior it can *observe* through a battery of inputs. It's a
strong net for pure, data-shaped functions — not a proof of total equivalence. (More on widening that below.)

## Where it fits

- **In CI:** snapshot on `main`, verify on the PR branch. Behavior changed unexpectedly? Non-zero exit fails the build —
  even with no test suite.
- **In an agent loop:** let the agent refactor, run `verify`, and feed the diff back as a hard signal. "You changed
  `running_sum([1,2,3])` from `[1,3,6]` to `[2,4,7]` — fix it" is a far better correction than "tests didn't run."
- **As a human pre-flight:** about to touch scary untested code? Snapshot first, refactor freely, verify before you push.

Python, JavaScript (CommonJS), and TypeScript (run via Node's built-in type-stripping) today. It's pure, deterministic,
and offline — no model required.

## Honest edges, and what's next

- Inputs come from a type-agnostic battery; next is **LLM-proposed inputs** (when a model is available) and
  **captured-run I/O** — harvesting *real* arguments from the repo's own examples/entrypoints for deeper coverage.
- Today it pins module-level functions and methods on zero-arg classes; constructor-args and stateful objects are next.
- A server endpoint + a one-click web panel are coming, so you can snapshot/verify from the Master-Anything UI, not just
  the CLI.

The code is small and readable:
[`snapshot.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/verifier/src/snapshot.ts) ·
[`firewall-cli.ts`](https://github.com/everettjf/Master-Anything/blob/main/packages/verifier/src/firewall-cli.ts).

## Try it

- **Repo:** <https://github.com/everettjf/Master-Anything>
- **The oracle it's built on:** [Making "verifiable" reach any function](./blog-universal-verification.html)
- **The learning side:** [Your mastery graph just became an asset](./blog-mastery-graph-quests.html)

Find the most untested, most load-bearing file in your repo. Snapshot it. Let your favorite agent loose on it. Then run
`verify` — and watch it tell you, to the input, whether you can trust the result.
