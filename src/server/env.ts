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

export class MissingConfigurationError extends Error {
  override name = "MissingConfigurationError";
}

const credentialsKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64")
  .transform(value => Buffer.from(value, "base64"))
  .refine(key => key.length === 32, "must decode to exactly 32 bytes");

let cachedCredentialsKey: Buffer | undefined;

/**
 * The master key for client API keys. Validated only where keys are encrypted
 * or decrypted, not in env(): a missing key should disable connections, not
 * take the whole app down on the deploy that introduces it.
 */
export function credentialsKey(): Buffer {
  cachedCredentialsKey ??= parseCredentialsKey(process.env["CREDENTIALS_ENCRYPTION_KEY"]);
  return cachedCredentialsKey;
}

export function parseCredentialsKey(value: string | undefined): Buffer {
  if (!value) {
    throw new MissingConfigurationError("CREDENTIALS_ENCRYPTION_KEY is not set");
  }
  const result = credentialsKeySchema.safeParse(value);
  if (!result.success) {
    throw new MissingConfigurationError(
      "Invalid environment variables: CREDENTIALS_ENCRYPTION_KEY",
    );
  }
  return result.data;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(schema, source);
}

export function parseDatabaseEnv(source: Record<string, string | undefined>): DatabaseEnv {
  return parseWith(databaseSchema, source);
}

/**
 * The Open Waters Google service account that reads every client's Search
 * Console property (add-search-console, design D3). Unset means Search Console
 * is not configured, and the feature is dormant. Set but malformed is a
 * configuration error, never "not configured", so a typo cannot quietly switch
 * the feature off. Base64 of the JSON key file, so it survives an env editor.
 */
export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
}

const googleKeySchema = z.object({
  type: z.literal("service_account"),
  client_email: z.email(),
  private_key: z.string().includes("PRIVATE KEY"),
});

export function parseGoogleServiceAccount(value: string | undefined): GoogleServiceAccount | null {
  if (!value) return null;
  const error = new MissingConfigurationError(
    "Invalid environment variables: GOOGLE_SERVICE_ACCOUNT_KEY",
  );
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    throw error;
  }
  const result = googleKeySchema.safeParse(json);
  if (!result.success) throw error;
  return { clientEmail: result.data.client_email, privateKey: result.data.private_key };
}

let cachedGoogle: GoogleServiceAccount | null | undefined;

export function googleServiceAccount(): GoogleServiceAccount | null {
  if (cachedGoogle === undefined) {
    cachedGoogle = parseGoogleServiceAccount(process.env["GOOGLE_SERVICE_ACCOUNT_KEY"]);
  }
  return cachedGoogle;
}

/** The Open Waters Bing Webmaster Tools account's API key. Unset: Bing is dormant. */
export function bingWebmasterApiKey(): string | null {
  const value = process.env["BING_WEBMASTER_API_KEY"]?.trim();
  return value ? value : null;
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
