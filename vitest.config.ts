import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // pytest/node integration tests spawn subprocesses; give them headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
