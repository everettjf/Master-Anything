# Case study: captured-run I/O on a real JS library (`object-path`)

This is the JavaScript companion to the [`toolz` study](../captured-run-toolz/README.md).
It makes a sharper point: captured-run I/O isn't only about pinning *more*
behaviors — it's about pinning the ones that **actually matter**.

[`object-path`](https://github.com/mariocasciaro/object-path) reads and writes
deep object properties by path — `get(obj, "a.b.c")`, `set`, `has`, `del`,
`coalesce`. The interesting argument is always a **nested object**, which the
synthetic fuzz battery never constructs. But object-path also *tolerates*
primitive arguments (`get(2, 2)` simply echoes the default `2`), so the battery
happily pins lots of behaviors — that exercise no path traversal at all.

- Library: `mariocasciaro/object-path`, version `0.11.8`, commit `e6bb638`, file `index.js`
- Node 22 · Master-Anything `@ma/verifier`
- The driver ([`driver.js`](./driver.js)) is adapted from object-path's own README.

## Reproduce

```bash
git clone --depth 1 https://github.com/mariocasciaro/object-path /tmp/object-path
node --import tsx docs/casestudy/captured-run-objectpath/measure.mts   # <1s
```

## Results — quantity, but mostly the *quality*

We count how many pinned behaviors are **grounded** (at least one argument is a
real object/array, i.e. the function's actual use case) vs degenerate (all
primitives):

| function | battery            | + `--entry`        |
| -------- | ------------------ | ------------------ |
| coalesce | 11 (0 grounded)    | 12 (1 grounded)    |
| del      | 12 (0 grounded)    | 16 (4 grounded)    |
| get      | 11 (0 grounded)    | 18 (7 grounded)    |
| has      | 13 (1 grounded)    | 16 (4 grounded)    |
| **total**| **47 (1 grounded)**| **62 (16 grounded)** |

The battery pins **47 behaviors — but only 1 of them touches a real object.** The
other 46 are things like:

```
has(0, 0)      -> false
get(0, 1, 2)   -> 2        # the path is a number; get just echoes the default
del(0, 0)      -> 0
```

A rewrite that completely broke path traversal would **still pass** against those
46 cases — they're false confidence. Captured-run adds the 15 grounded behaviors
that pin what `object-path` is actually *for*:

```
get(*[{"a":{"b":{"c":42,...}},"users":[{"name":"Alice"},...]}, "a.b.c"]) -> 42
has(*[{...}, "a.b.c"]) -> true
del(*[{"c":1,"d":2}, ["c"]]) -> {"d":2}
coalesce(*[{...}, ["a.x","a.y","a.b.c"], "default"]) -> 42
```

### Mutating functions are captured correctly

`del` and `set` mutate their object argument. Captured-run snapshots the argument
**before** the call, so `del({"c":1,"d":2}, ["c"]) -> {"d":2}` records the
pre-deletion input — replaying it reproduces the output. (Recording after the
call would have stored the already-mutated object, which wouldn't.)

## TypeScript: read-only exports, captured via a loader

A TypeScript ESM module's namespace exports are **read-only** — you can't wrap a
top-level `export function` in-process the way you can a CommonJS export. So for
TS, captured-run registers a module loader that redirects imports of the target
to a generated **shim** which re-exports each function wrapped to record I/O
(class prototypes, being mutable, are patched directly). The driver imports the
target as usual and transparently gets the instrumented module — so a top-level
`export function totalPrice(order)` taking a nested object becomes capturable and
verifiable. Proven end-to-end in
[`test/capture.test.ts`](../../../test/capture.test.ts) (a read-only top-level TS
export goes from `null` to verifiable via captured I/O).

## Takeaway

On real JS code, the fuzz battery's coverage was **97% degenerate** (46 of 47
behaviors never touched an object). Captured-run I/O, driven by the library's own
documented usage, pinned the path-traversal behaviors that the battery
structurally cannot reach — turning the firewall from *false confidence* into a
real regression net, in under a second, offline.
