import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { clients, reportRecipients } from "@/db/schema";
import { requireSession } from "@/server/session";
import { fieldError, formError, fromZodError, isUniqueViolation, ok, type Result } from "./result";
import { recipientSchema } from "./schemas";

export async function addRecipient(clientSlug: string, input: unknown): Promise<Result> {
  await requireSession();
  const parsed = recipientSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const [client] = await getDb()
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.slug, clientSlug));
  if (!client) return formError("That client no longer exists.");

  try {
    // The schema lower-cases the address, so the unique constraint is
    // effectively case-insensitive.
    await getDb()
      .insert(reportRecipients)
      .values({ clientId: client.id, ...parsed.data });
    return ok();
  } catch (error) {
    if (isUniqueViolation(error, "report_recipients_client_email_unique")) {
      return fieldError("email", "That address is already a recipient for this client.");
    }
    throw error;
  }
}

export async function removeRecipient(clientSlug: string, recipientId: string): Promise<Result> {
  await requireSession();
  const [client] = await getDb()
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.slug, clientSlug));
  if (!client) return formError("That client no longer exists.");

  await getDb()
    .delete(reportRecipients)
    .where(and(eq(reportRecipients.id, recipientId), eq(reportRecipients.clientId, client.id)));
  return ok();
}
