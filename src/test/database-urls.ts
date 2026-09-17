/**
 * Where integration tests connect. Shared by vitest.config.ts (which hands the
 * test URL to test workers) and global-setup.ts (which runs in the main process,
 * where the config's `test.env` does not apply).
 */
export function testDatabaseUrls(source: Record<string, string | undefined>) {
  const server = new URL(
    source["DATABASE_URL"] ?? "postgres://analytics:analytics@localhost:5433/analytics",
  );
  const test = new URL(server);
  test.pathname = "/analytics_test";
  return { server: server.toString(), test: test.toString() };
}
