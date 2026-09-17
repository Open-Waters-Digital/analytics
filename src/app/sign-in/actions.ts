"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestMagicLink } from "@/server/sign-in";

export interface SignInFormState {
  email: string;
  fieldError?: string;
  formError?: string;
}

export async function signIn(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const email = String(formData.get("email") ?? "");
  const returnTo = formData.get("returnTo");

  const result = await requestMagicLink(
    { email, returnTo: typeof returnTo === "string" ? returnTo : null },
    await headers(),
  );

  if (!result.ok && result.reason === "invalid_email") {
    return { email, fieldError: "Enter an email address, like name@openwaters.digital." };
  }
  if (!result.ok && result.reason === "rate_limited") {
    return { email, formError: "Too many sign-in requests. Wait 10 minutes, then try again." };
  }
  redirect("/sign-in/check-email");
}
