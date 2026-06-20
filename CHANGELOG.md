# Changelog

## 0.2.0 — Grounded characterization

The characterization oracle (thrust A) no longer depends on fuzzing primitives.
It now draws inputs from **three** sources — all objectively filtered by the same
oracle (round-trip to a literal, stable across two runs) — so functions whose
arguments the fuzzer can't construct become verifiable, and the Behavioral
Firewall pins the behaviors that actually matter.

### Added

- **Captured-run I/O** ([`@ma/verifier`](packages/verifier/src/capture.ts)) — run
  the repo's own example/entrypoint with the target module instrumented and pin
  the *real* arguments→return observed at each function boundary. Merges into both
  the characterization oracle (`characterize({ entrypoint })`) and the firewall
  (`snapshotFile({ entrypoint })` / `ma-firewall snapshot --entry <driver>`).
  - **Python, JavaScript, and TypeScript** capture functions *and* methods. TS
    namespace exports are read-only, so a module loader redirects the target to a
    generated shim that re-exports each function wrapped; class prototypes are
    patched in-process.
  - Arguments are snapshotted **before** the call, so a function that mutates its
    input still records the correct pre-call value.
- **LLM-proposed inputs** ([`@ma/core`](packages/core/src/propose.ts)) — when a
  model is configured, it proposes domain-representative argument-lists from a
  function's source; they feed `characterize({ proposedInputs })` through the same
  filter. A function becomes verifiable with neither a test nor a driver. Offline,
  the deterministic battery stands alone. Wired into the Apply loop.
- **Web Firewall panel** — an optional *Entrypoint* field drives captured-run from
  the UI (`POST /repos/:id/firewall/snapshot` accepts `entrypoint`).
- **Real-library case studies** — [`pytoolz/toolz`](docs/casestudy/captured-run-toolz/README.md)
  (Python) and [`object-path`](docs/casestudy/captured-run-objectpath/README.md)
  (JS, where the fuzzer's coverage was 97% degenerate), each with a reproducible
  measurement script.

### Notes

- `ma-firewall` gains `--entry <driver>`; non-zero exit on behavior change is
  unchanged, so it still drops into CI / an agent loop.
- All additions degrade honestly: with no driver and no model, behavior is exactly
  as before (the battery).
