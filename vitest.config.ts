import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx,mts,cts}"],
    exclude: ["node_modules", "test/fixtures/**"],
  },
});
