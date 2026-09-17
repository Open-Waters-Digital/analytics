import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Tables scroll horizontally inside their own wrapper on small screens rather
 * than collapsing into cards: this data is compared across columns. Digits are
 * tabular so figures line up down a column; applied here rather than on the body
 * because tabular figures also widen hyphens in running text.
 */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-left text-data tabular-nums", className)}
        {...props}
      />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-(--row-height-compact) border-b border-hairline px-3 text-label text-ink-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn("h-(--row-height) border-b border-hairline px-3 align-middle", className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-surface-hover", className)} {...props} />;
}
