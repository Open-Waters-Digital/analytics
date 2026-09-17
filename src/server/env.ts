import { z } from "zod";

/**
 * Server environment, validated once at first use. Every server module reads
 * configuration through `env()`, never `process.env`, so a missing or malformed
 * variable fails loudly at the boundary instead of as `undefined` deep inside a
 * query. Variables are added here in the same change that first needs them.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Names only: a value could be a secret.
    const names = result.error.issues.map(issue => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${names}`);
  }
  return result.data;
}
