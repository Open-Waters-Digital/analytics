import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-(--gutter) py-12">
      <p className="text-label text-ink-muted uppercase">Open Waters</p>
      <h1 className="text-display">Check your email</h1>
      <p>
        If that address can sign in, a link is on its way. It works once and expires in 15 minutes.
      </p>
      <p className="text-ink-muted">
        Nothing arrived?{" "}
        <Link href="/sign-in" className="font-medium text-ink underline underline-offset-4">
          Request another link
        </Link>
        .
      </p>
    </main>
  );
}
