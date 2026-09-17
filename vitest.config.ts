import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabaseUrls } from "./src/test/database-urls";

/**
 * Integration tests run against a dedicated `analytics_test` database on the
 * same Postgres server as DATABASE_URL (compose locally, the service container
 * in CI). src/test/global-setup.ts recreates and migrates it before every run,
 * so local data is never touched. Needs `pnpm db:up` locally.
 */
const urls = testDatabaseUrls(process.env);

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside a React Server Components build. Tests run
      // server modules directly, so it becomes an empty module here.
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    env: { DATABASE_URL: urls.test },
  },
});
