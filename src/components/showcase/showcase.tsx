import type { ReactNode } from "react";

export function Section({
  title,
  importPath,
  children,
}: {
  title: string;
  importPath?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline py-8">
      <header>
        <h2 className="text-title">{title}</h2>
        {importPath ? <code className="text-caption text-ink-muted">{importPath}</code> : null}
      </header>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label text-ink-muted uppercase">{label}</p>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </div>
  );
}

export function Entry({ code, children }: { code: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <div>{children}</div>
      <figcaption>
        <code className="text-caption text-ink-muted">{code}</code>
      </figcaption>
    </figure>
  );
}
