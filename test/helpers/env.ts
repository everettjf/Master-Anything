/**
 * Test-environment probes. The Python integration tests need `python3` with
 * `pytest` importable; when that's missing (a fresh clone without
 * `pip install pytest`) we skip them rather than fail, so a first `pnpm test`
 * is green on the parts that don't depend on a Python toolchain. CI installs
 * pytest, so it always runs the full suite.
 */
import { spawnSync } from "node:child_process";

function probe(args: string[]): boolean {
  try {
    return spawnSync("python3", args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** `python3` is on PATH (the snapshot/characterize harnesses spawn it with stdlib only). */
export const hasPython3 = probe(["--version"]);
/** `python3` can import pytest (the pytest-runner integration tests need this). */
export const hasPytest = hasPython3 && probe(["-c", "import pytest"]);

if (!hasPytest) {
  console.warn(
    "\n⚠ pytest not found (python3 -c 'import pytest' failed) — skipping Python integration tests.\n" +
      "  Install it to run the full suite:  python3 -m pip install pytest\n",
  );
}
