import type { ReactNode } from "react";
import { alertClasses, type AlertTone } from "./variants";

const LEADS: Record<AlertTone, string> = {
  info: "Note",
  success: "Done",
  warning: "Check",
  danger: "Error",
};

/**
 * A message with a text lead ("Error:", "Note:") so colour is never the only
 * signal. Errors and warnings announce themselves to screen readers.
 */
export function Alert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  const urgent = tone === "danger" || tone === "warning";
  return (
    <div role={urgent ? "alert" : "status"} className={alertClasses(tone)}>
      <span className="font-semibold">{LEADS[tone]}:</span> {children}
    </div>
  );
}
