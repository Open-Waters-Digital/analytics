import type { z } from "zod";

/**
 * What every registry mutation returns. Validation problems are values, not
 * exceptions, so forms can show them next to the right field. Only a missing
 * session throws (UnauthorisedError), because that is not the form's problem.
 */
export type FieldErrors = Record<string, string>;

export type Result<T = undefined> =
  { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors; formError?: string };

export function ok(): Result<undefined>;
export function ok<T>(value: T): Result<T>;
export function ok<T>(value?: T): Result<T | undefined> {
  return { ok: true, value };
}

export function fieldError(field: string, message: string): Result<never> {
  return { ok: false, fieldErrors: { [field]: message } };
}

export function formError(message: string): Result<never> {
  return { ok: false, fieldErrors: {}, formError: message };
}

/** The first message for each field, keyed by the top-level field name. */
export function fromZodError(error: z.ZodError): Result<never> {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

/** Postgres error fields, found through Drizzle's DrizzleQueryError wrapper. */
export function postgresErrorOf(
  error: unknown,
): { code: string; constraint: string | undefined } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && current !== null && "code" in current) {
      const code = (current as { code: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        const constraint = (current as { constraint_name?: unknown }).constraint_name;
        return { code, constraint: typeof constraint === "string" ? constraint : undefined };
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = postgresErrorOf(error);
  return pg?.code === "23505" && pg.constraint === constraint;
}
