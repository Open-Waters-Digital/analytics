import type { ReactNode } from "react";
import { panelClasses } from "./variants";

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={panelClasses(className)}>
      {title ? (
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-4 py-3">
          <h2 className="text-title">{title}</h2>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
