/**
 * Pick a test runner from the environment:
 *   MA_SANDBOX=docker -> DockerPytestRunner (if a daemon is available)
 *   otherwise         -> LocalPytestRunner (subprocess on the host)
 *
 * Docker is probed once; if unavailable we fall back to local with a warning,
 * so a misconfigured MA_SANDBOX never breaks the mastery loop.
 */
import { DockerPytestRunner, dockerAvailable } from "./docker.js";
import { LocalPytestRunner, type TestRunner } from "./runner.js";

export interface RunnerInfo {
  runner: TestRunner;
  describe: string;
}

export async function makeRunner(env: NodeJS.ProcessEnv = process.env): Promise<RunnerInfo> {
  if ((env.MA_SANDBOX ?? "").toLowerCase() === "docker") {
    if (await dockerAvailable()) {
      const image = env.MA_SANDBOX_IMAGE ?? "python:3.11";
      return { runner: new DockerPytestRunner(), describe: `docker (${image})` };
    }
    console.warn("MA_SANDBOX=docker but no Docker daemon found — using local runner");
  }
  return { runner: new LocalPytestRunner(), describe: "local pytest (subprocess)" };
}
