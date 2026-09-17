import { describe, expect, it } from "vitest";
import { connectionDisplay, formatMoney, formatPercent } from "./registry-labels";

describe("registry labels", () => {
  it("shows client-owned analytics instead of a connection problem", () => {
    expect(connectionDisplay(null, true)).toEqual({
      tone: "neutral",
      label: "Client-owned analytics",
    });
    expect(connectionDisplay(null, false)).toEqual({ tone: "warning", label: "Not connected" });
  });

  it.each([
    ["ok", "Connected"],
    ["unauthorised", "Key rejected"],
    ["project_not_found", "Project not found"],
    ["error", "Check failed"],
  ] as const)("labels status %s as %s", (status, label) => {
    expect(connectionDisplay({ lastCheckStatus: status }, false).label).toBe(label);
  });

  it("formats money from minor units", () => {
    expect(formatMoney(250000, "GBP")).toBe("£2,500");
    expect(formatMoney(250050, "GBP")).toBe("£2,500.50");
    expect(formatMoney(100, "EUR")).toBe("€1");
  });

  it("formats a rate as a percentage", () => {
    expect(formatPercent("0.2000")).toBe("20%");
    expect(formatPercent("0.1250")).toBe("12.5%");
  });
});
