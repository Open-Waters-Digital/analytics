import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requirePageSession } from "@/server/session";
import { signOut } from "./actions";

/**
 * Everything inside (app) requires a session. The check here protects the
 * pages; data functions in src/server check again, because a layout is not a
 * security boundary for server actions.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requirePageSession();

  return (
    <div className="min-h-dvh">
      <header className="border-b border-hairline bg-surface-raised">
        <div className="mx-auto flex max-w-(--container-max) flex-wrap items-center gap-x-6 gap-y-2 px-(--gutter) py-3">
          <Link href="/" className="font-medium">
            Open Waters Analytics
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-4 text-data">
            <Link href="/" className="text-ink-muted hover:text-ink">
              Clients
            </Link>
            <Link href="/design-system" className="text-ink-muted hover:text-ink">
              Design system
            </Link>
          </nav>
          <div className="flex items-center gap-3 md:ml-auto">
            <span className="text-caption text-ink-muted">{session.user.email}</span>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
