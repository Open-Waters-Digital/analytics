"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth";

/** Deletes the session on the server, not only the cookie in the browser. */
export async function signOut(): Promise<void> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // No valid session to end: the visitor is already signed out.
  }
  redirect("/sign-in");
}
