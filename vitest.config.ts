import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Timing benchmarks vary with machine load, so they stay out of the normal run and CI.
    // Run them on demand with `bun run test:perf`.
    exclude: process.env.PERF ? [] : ["src/**/*.perf.test.ts"],
    setupFiles: ["src/test-setup.ts"],
  },
});
