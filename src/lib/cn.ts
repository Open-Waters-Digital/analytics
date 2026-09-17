import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be told about the custom scales in tokens.css.
 * Without this it cannot tell that `text-body` is a font size, treats it as a
 * text colour, and drops `text-ink-inverse` when both appear: the primary
 * button then renders black text on a black background. Keep these lists in
 * step with the `--text-*` and `--shadow-*` tokens.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title", "body", "data", "label", "caption"],
      shadow: ["float"],
    },
  },
});

/** Joins class names and lets a later Tailwind utility override an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
