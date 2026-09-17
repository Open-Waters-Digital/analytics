import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/server/access";
import { getSession } from "@/server/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const returnTo = typeof params.returnTo === "string" ? safeReturnTo(params.returnTo) : null;

  if (await getSession()) redirect(returnTo ?? "/");

  const linkFailed = params.error !== undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-(--gutter) py-12">
      <header className="flex flex-col gap-2">
        <p className="text-label text-ink-muted uppercase">Open Waters</p>
        <h1 className="text-display">Sign in</h1>
        <p className="text-ink-muted">We will email you a link that signs you in.</p>
      </header>
      {linkFailed ? (
        <p
          role="alert"
          className="rounded-md bg-warning-subtle px-3 py-2 text-caption text-warning"
        >
          That sign-in link has already been used or has expired. Request a new one below.
        </p>
      ) : null}
      <SignInForm returnTo={returnTo === "/" ? null : returnTo} />
    </main>
  );
}
