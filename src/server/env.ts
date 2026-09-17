import { z } from "zod";

/**
 * Server environment, validated once at first use. Every server module reads
 * configuration through these functions, never `process.env`, so a missing or
 * malformed variable fails loudly at the boundary instead of as `undefined` deep
 * inside a query. Variables are added here in the same change that first needs
 * them.
 *
 * Validation is lazy on purpose: `next build` imports server modules, and the
 * build must not need runtime secrets (see AGENTS.md → Deploy).
 */
const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ });

const databaseSchema = z.object({ DATABASE_URL: databaseUrl });

export type DatabaseEnv = z.infer<typeof databaseSchema>;

const emailList = z
  .string()
  .transform(value =>
    value
      .split(",")
      .map(entry => entry.trim().toLowerCase())
      .filter(entry => entry.length > 0),
  )
  .pipe(z.array(z.email()).min(1, "must list at least one address"))
  .transform(entries => new Set(entries) as ReadonlySet<string>);

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: databaseUrl,

    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    RESEND_API_KEY: z.string().min(1).optional(),
    AUTH_EMAIL_FROM: z.string().min(3),
    AUTH_ALLOWED_EMAILS: emailList,
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;
    // Without a key the development fallback would print sign-in links to the
    // logs. Requiring the key in production makes that path unreachable.
    if (!value.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required in production" });
    }
    if (!value.BETTER_AUTH_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "must be https" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
let cachedDatabase: DatabaseEnv | undefined;

/** Everything the web app needs. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * Only the database connection. The migration script and the database client
 * use this, so applying migrations never depends on unrelated secrets.
 */
export function databaseEnv(): DatabaseEnv {
  cachedDatabase ??= parseDatabaseEnv(process.env);
  return cachedDatabase;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(schema, source);
}

export function parseDatabaseEnv(source: Record<string, string | undefined>): DatabaseEnv {
  return parseWith(databaseSchema, source);
}

function parseWith<T>(target: z.ZodType<T>, source: Record<string, string | undefined>): T {
  const result = target.safeParse(source);
  if (!result.success) {
    // Names only: a value could be a secret.
    const names = [...new Set(result.error.issues.map(issue => issue.path.join(".")))].join(", ");
    throw new Error(`Invalid environment variables: ${names}`);
  }
  return result.data;
}
