import { describe, expect, it } from "vitest";
import { buttonClasses, inputClasses } from "@/components/ui/variants";
import { cn } from "./cn";

describe("cn", () => {
  // Regression: custom font sizes were read as colours and removed the
  // colour class, leaving primary buttons with invisible labels.
  it.each(["display", "title", "body", "data", "label", "caption"])(
    "keeps a text colour alongside text-%s",
    size => {
      const result = cn("text-ink-inverse", `text-${size}`);
      expect(result).toContain("text-ink-inverse");
      expect(result).toContain(`text-${size}`);
    },
  );

  it("still lets a later size override an earlier one", () => {
    expect(cn("text-body", "text-data")).toBe("text-data");
  });

  it("still lets a later colour override an earlier one", () => {
    expect(cn("text-ink", "text-danger")).toBe("text-danger");
  });

  it.each(["primary", "danger"] as const)(
    "keeps the inverse label colour on %s buttons",
    variant => {
      for (const size of ["md", "sm"] as const) {
        expect(buttonClasses({ variant, size })).toContain("text-ink-inverse");
      }
    },
  );

  it("keeps the input text colour alongside its size", () => {
    expect(inputClasses()).toContain("text-ink");
    expect(inputClasses()).toContain("text-body");
  });
});
