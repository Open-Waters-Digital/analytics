import type { ReactNode } from "react";
import { badgeClasses, dotClasses, type Tone } from "./variants";

export function Badge({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={badgeClasses({ tone })}>{children}</span>;
}

/** A coloured dot always paired with text: colour alone never carries meaning. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-data">
      <span aria-hidden="true" className={dotClasses(tone)} />
      {label}
    </span>
  );
}
