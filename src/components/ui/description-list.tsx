import type { ReactNode } from "react";

export interface DescriptionItem {
  term: string;
  value: ReactNode;
}

/** Term and value pairs: stacked on phones, two columns from md up. */
export function DescriptionList({ items }: { items: readonly DescriptionItem[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-data md:grid-cols-[minmax(10rem,auto)_1fr]">
      {items.map(item => (
        <div key={item.term} className="contents">
          <dt className="text-ink-muted">{item.term}</dt>
          <dd className="-mt-2 break-words md:mt-0">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
