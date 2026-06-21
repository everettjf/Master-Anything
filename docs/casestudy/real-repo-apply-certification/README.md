# Case study: the Apply loop on real OSS repos (end-to-end certification)

**Claim under test:** the Apply loop's objective grade — _"blank a function, let an
agent reimplement it, then verify with the project's **real** test suite or a
**synthesized characterization oracle**"_ — holds on **real third-party
repositories**, not just the in-repo toy fixtures.

We verify it with two **control agents** run through the public orchestrator
([`certifyAgent`](../../../packages/server/src/certify.ts)):

- **oracle** — submits the reference implementation. A correct engine must pass
  **every** gradable unit.
- **lazy** — leaves the blank stub. A correct engine must pass **none**.

Perfect discrimination (oracle 100% / lazy 0%) is the proof the grade is
objective, not vibes. Both solvers need no API key, so this doubles as a
clean-room self-test of the verification engine on real code.

| Repo | commit | what it exercises |
| ---- | ------ | ----------------- |
| [`jpvanhal/inflection`](https://github.com/jpvanhal/inflection) | `88eefaa` | flat single-file lib, **green** pytest suite (467 tests) → **suite** oracle |
| [`un33k/python-slugify`](https://github.com/un33k/python-slugify) | `7b6d5d9` | a **package** (`slugify/`), green suite (82 tests) → **suite** oracle |
| [`python-humanize/humanize`](https://github.com/python-humanize/humanize) | `976484a` | `src/` layout package, **red** suite from fresh clone (missing test deps) → **characterization** oracle |

Python 3.11 · Node 22 · pytest 9.

## Reproduce

```bash
# clone the three libraries (slugify needs its one runtime dep importable)
git clone --depth 1 https://github.com/jpvanhal/inflection       /tmp/e2e/inflection
git clone --depth 1 https://github.com/un33k/python-slugify      /tmp/e2e/python-slugify
git clone --depth 1 https://github.com/python-humanize/humanize  /tmp/e2e/humanize
python3 -m pip install text-unidecode

# certify each repo with both control agents
pnpm --filter @ma/server certify /tmp/e2e/inflection      --solver oracle
pnpm --filter @ma/server certify /tmp/e2e/inflection      --solver lazy
pnpm --filter @ma/server certify /tmp/e2e/python-slugify  --solver oracle
pnpm --filter @ma/server certify /tmp/e2e/humanize        --solver oracle --limit 40
```

`certify-cli` ingests the repo (graph → units → learning path), then for every
implementable unit blanks the target and grades the solver's reimplementation
with real tests / the characterization oracle. The clone is never mutated — every
test run happens in a materialized temp copy.

## Results

| Repo | implementable units | gradable | verified by | **oracle** | **lazy** |
| ---- | ------------------: | -------: | ----------- | ---------: | -------: |
| inflection | 13 | 13 | suite | **13/13 (100%)** | **0/13 (0%)** |
| python-slugify | 13 | 11 | suite | **11/11 (100%)** | **0/11 (0%)** |
| humanize | 28 | 6 | characterization | **6/6 (100%)** | **0/6 (0%)** |

The engine discriminates **perfectly** on all three: every reference
implementation passes, every blank fails — across both verification paths (the
repo's own suite, and the synthesized characterization oracle) and across both
flat and packaged / `src`-layout repositories.

## What only a real repo exposed (4 bugs found & fixed)

The toy fixtures are flat, single-file, fully test-covered, and contain no
third-party packaging. Real repos broke four assumptions that toys never could.
Each is now fixed and covered by a regression test.

1. **A repo's own test functions were ingested as learning units.** On
   `inflection`, **22 of 36** "units" (61%) were the project's `test_*`
   functions. Reimplementing a test is circular — a blanked test trivially
   errors, and the test is its own oracle. `buildUnits` now excludes test files
   (kept in the graph so they still run as the suite). _(packages/core/src/units.ts — `isTestPath`)_

2. **No green-suite baseline → correct code judged wrong.** humanize's suite is
   red from a fresh clone (missing `freezegun` etc. → collection errors). The
   probe read "blanked → tests fail" as "function is covered," so it marked
   functions verifiable and then **failed even the reference implementation**.
   The probe now requires the suite to be **green on the unmodified repo** before
   trusting it as an oracle; otherwise it falls through to characterization.
   _(packages/server/src/mastery-store.ts — `isSuiteGreen`)_

3. **Characterization tests couldn't import the target in packaged repos.** The
   synthesized pytest test imported the module by basename (`from i18n import …`)
   — fine for a flat toy, but pytest resolves it under the package name in a
   `src` layout, and importing the package runs an `__init__` that a fresh clone
   can't satisfy (a setuptools_scm `_version` that only exists post-install). The
   test now **loads the source file directly by path** (bypassing package init,
   exactly like the capture harness) and lives at the repo root.
   _(packages/verifier/src/characterize.ts — `pyTest`, `placeTest`)_

4. **Characterization accepted a never-passing oracle.** Validation only checked
   the synthesized test _fails on the blank_ — a broken test (e.g. bug #3's
   import error) fails on the blank **and** the original, so it slipped through
   as "verifiable," then failed every submission. Validation now requires the
   test to **pass on the original AND fail on the blank** — the correct
   golden-master invariant. _(packages/server/src/mastery-store.ts)_

A fifth, smaller gap: there was **no CLI** to point the Apply loop at a repo (it
lived only behind the HTTP API). [`certify-cli`](../../../packages/server/src/certify-cli.ts)
(`pnpm --filter @ma/server certify`) fills it, and the orchestrator — previously
covered only for its pure leaderboard helper — now has an end-to-end regression
test ([`test/certify-e2e.test.ts`](../../../test/certify-e2e.test.ts)).
