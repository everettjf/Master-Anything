# Case study: captured-run I/O on a real library (`pytoolz/toolz`)

**Claim under test:** the synthetic fuzz battery only verifies arithmetic-shaped
functions; **captured-run I/O** (run the repo's own example with the target
instrumented, pin the real boundary I/O) extends verification to functions whose
arguments the battery can't construct.

We test it on a real, widely-used OSS library — [`toolz`](https://github.com/pytoolz/toolz)'s
`dicttoolz` module, whose functions operate on **dicts and nested
structures**. The driver ([`driver.py`](./driver.py)) is built from the examples
in toolz's **own docstrings** — i.e. the documented, real-world way the library
is called.

- Library: `pytoolz/toolz`, commit `568c2b8`, file `toolz/dicttoolz.py`
- Python 3.11 · Node 22 · Master-Anything `@ma/verifier`
- `dicttoolz` imports only the stdlib, so it loads as a standalone module — no
  toolz install required.

## Reproduce

```bash
git clone --depth 1 https://github.com/pytoolz/toolz /tmp/toolz
node --import tsx docs/casestudy/captured-run-toolz/measure.mts   # ~2s
```

The script copies `dicttoolz.py` + `driver.py` into a throwaway repo (the clone
is never mutated) and measures battery-only vs `--entry` for both the Behavioral
Firewall and the characterization (Apply) oracle.

## Results

### Behavioral Firewall — functions / behaviors pinned

| function     | battery | + `--entry` | gain |
| ------------ | ------: | ----------: | ---: |
| assoc        |       0 |           2 |  +2  |
| assoc_in     |       0 |           1 |  +1  |
| dissoc       |       2 |           5 |  +3  |
| get_in       |      13 |          17 |  +4  |
| merge        |       1 |           3 |  +2  |
| merge_with   |      11 |          11 |      |
| **total**    |  **27** |      **39** |      |

**Functions pinned: 4 → 6. Behaviors pinned: 27 → 39 (+44%).** `assoc` and
`assoc_in` were *completely* invisible to the fuzzer (it never builds a dict
argument); the driver makes them guardable. The functions the battery already
reached (`dissoc`, `get_in`, `merge`) gained grounded, real-world cases on top.

### Characterization (Apply) — verifiable without / with the driver

| function  | battery        | + `--entry`   |
| --------- | -------------- | ------------- |
| assoc     | *unverifiable* | **2 cases ✓** |
| dissoc    | 2 cases ✓      | 5 cases ✓     |
| assoc_in  | *unverifiable* | *unverifiable* (1 captured case — one short of the ≥2 threshold) |
| get_in    | 13 cases ✓     | 17 cases ✓    |
| merge     | *unverifiable* | **2 cases ✓** |

`assoc` and `merge` cross from **unverifiable to verifiable** purely from real
usage. (`assoc_in` was observed once in the driver; characterization requires ≥2
distinct cases to synthesize a test, so it stays just under the bar even though
the *firewall*, which accepts a single pinned behavior, guards it.)

### Sample captured inputs (the fuzzer can't build these)

```
assoc(*[{'x': 1}, 'x', 2]) -> {'x': 2}
dissoc(*[{'x': 1, 'y': 2}, 'y']) -> {'x': 1}
get_in(*[['order', 'items'], {'name': 'Alice', 'order': {'items': ['Apple', 'Orange'],
        'costs': [0.5, 1.25]}, 'credit card': '5555-1234-1234-1234'}]) -> ['Apple', 'Orange']
assoc_in(*[{'name': 'Alice'}, ['order', 'items'], ['Apple', 'Orange']])
        -> {'name': 'Alice', 'order': {'items': ['Apple', 'Orange']}}
merge(*[{1: 'one'}, {2: 'two'}]) -> {1: 'one', 2: 'two'}
```

## Honest limitations (also measured)

- **Callable arguments aren't captured.** `update_in`, `valmap`, `keyfilter`,
  `merge_with` take a *function* as an argument. A function isn't a literal, so
  captured-run records nothing for those call shapes — the driver exercises them
  but they don't appear as new pinned cases. This is by design (only
  literal-round-tripping I/O is replayable) and is the next frontier
  (LLM-proposed inputs / property assertions).
- **Characterization needs ≥2 cases** to emit a test; a function observed once
  (`assoc_in` here) is pinned by the firewall but not yet turned into an Apply
  exam. More driver coverage closes this.
- Capture only sees calls the driver actually makes — coverage is exactly as good
  as the example you point it at. That's the point (grounded, not guessed), but
  it means the driver matters.

## Takeaway

On real library code, captured-run I/O did what the synthetic battery
structurally cannot: it pinned and verified **dict/structure-shaped functions**
from the library's own documented usage, lifting the firewall from 4 to 6
functions (27 → 39 behaviors) and making `assoc`/`merge` verifiable for the Apply
loop — in ~2 seconds, offline, with no test suite and no install.
