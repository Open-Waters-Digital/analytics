/**
 * Bundles the Node entry points that run outside Next (the migration script,
 * and later the nightly jobs) into self-contained files in dist/. The runtime
 * image has no node_modules beyond what Next traced, so each script carries
 * its own dependencies.
 *
 * Uses esbuild's JS API rather than its CLI: pnpm's bin shim for esbuild breaks
 * once esbuild's postinstall swaps in the native binary.
 */
import { build } from "esbuild";

await build({
  entryPoints: { migrate: "scripts/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: "tsconfig.json",
  // Some bundled dependencies still call require(); ESM has no require.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "info",
});
