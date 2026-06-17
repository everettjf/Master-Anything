# ma-firewall — the Behavioral Firewall

> **Let an AI rewrite your untested code — and prove it didn't change behavior.**

A regression safety net for code that has **no tests**. `ma-firewall` discovers
every function (and zero-arg-class method) in a file, runs it on a battery of
inputs, and **pins its deterministic, literal-returning behavior** as a portable
JSON snapshot. Let an agent (or a human) rewrite the file, then `verify` — it
proves behavior is preserved, or reports the exact `(function, input)` that
changed and **old → new**. Non-zero exit on a change, so it drops straight into
CI or an agent loop.

Zero dependencies, zero config. **Python · JavaScript · TypeScript.**

Part of [Master-Anything](https://github.com/everettjf/Master-Anything) — the same
characterization oracle that makes untested functions *learnable* also makes AI
edits to them *verifiable*.

## Install

```bash
# one-off, no install
npx ma-firewall snapshot src/utils.py

# or globally
npm i -g ma-firewall
```

Requires Node ≥ 18. For Python files, `python3` must be on `PATH`.

## Usage

```bash
# 1. pin the current behavior of a file
ma-firewall snapshot src/utils.py -o utils.behavior.json

# 2. …let an AI (or you) rewrite src/utils.py…

# 3. prove the rewrite preserved behavior (exit 1 if not)
ma-firewall verify src/utils.py utils.behavior.json
```

```
✓ snapshot: 2 functions, 24 behaviors pinned → utils.behavior.json
    clamp  (11)
    add  (13)

✅ behavior preserved — 24/24 behaviors unchanged in src/utils.py
```

…and when a rewrite changes behavior:

```
❌ behavior CHANGED in src/utils.py

  1 behavior(s) differ:
    clamp(12, -1, 7)
        was  7
        now  8
```

## How it works

Only **deterministic, literal-returning** behavior is pinned: a captured value is
kept only if it round-trips to a literal (Python `repr` / JS `JSON` +
`util.isDeepStrictEqual`) **and** is stable across two runs. So the firewall never
false-alarms on nondeterminism (clocks, randomness, I/O) — it simply doesn't pin
what it can't pin. Functions are discovered by language-native reflection, so
there's no parser to configure.

## Complex arguments — capture real I/O with `--entry`

The built-in fuzzer feeds primitives and collections, which can't construct the
rich arguments real code often takes (a config dict, a nested order, a domain
object) — those functions snapshot empty. Point `--entry` at a script your repo
already ships and the firewall **instruments the file, runs the driver, and pins
the real input→output** it observes at each function boundary:

```bash
ma-firewall snapshot src/pricing.py --entry examples/demo.py -o pricing.behavior.json
# ✓ snapshot: 2 functions, 4 behaviors pinned → pricing.behavior.json
#     total_price  (2)
#     Cart.line_count  (2)
```

Captured cases are filtered exactly like fuzzed ones (deterministic,
literal-round-tripping, stable across two runs), then `verify` works the same —
catching a regression on the real input with the exact `(function, input)` and
old → new. Python and JavaScript capture functions and methods; TypeScript
captures methods.

## In CI

Commit the snapshot next to the code, and fail the build if an edit changes
behavior:

```yaml
# .github/workflows/firewall.yml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npx ma-firewall verify src/utils.py src/utils.behavior.json
```

The non-zero exit on a behavioral change fails the job. Pair it with an agent that
rewrites legacy code and you have a guardrail that blocks behavior drift before it
merges.

## License

[MIT](https://github.com/everettjf/Master-Anything/blob/main/LICENSE)
