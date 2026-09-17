/**
 * One style recipe per primitive. Every build of a primitive imports its recipe
 * from here, so a variant is defined exactly once. Class strings stay literal:
 * Tailwind scans source text, so an interpolated `bg-${tone}` produces no CSS.
 */
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-ink-inverse hover:bg-ink-hover",
  secondary: "border border-border bg-surface-raised text-ink hover:bg-surface-hover",
  ghost: "text-ink hover:bg-surface-hover",
  danger: "bg-danger text-ink-inverse hover:opacity-90",
};

const buttonSizes: Record<ButtonSize, string> = {
  md: "h-(--control-height) px-4 text-body",
  sm: "h-9 px-3 text-data",
};

export function buttonClasses(
  options: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  const { variant = "primary", size = "md", className } = options;
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-muted",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
};

export function badgeClasses(options: { tone?: Tone; className?: string } = {}): string {
  const { tone = "neutral", className } = options;
  return cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium",
    badgeTones[tone],
    className,
  );
}

const dotTones: Record<Tone, string> = {
  neutral: "bg-ink-subtle",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function dotClasses(tone: Tone): string {
  return cn("size-2 shrink-0 rounded-full", dotTones[tone]);
}

export function panelClasses(className?: string): string {
  return cn("rounded-md border border-hairline bg-surface-raised", className);
}

export function inputClasses(options: { invalid?: boolean; className?: string } = {}): string {
  return cn(
    "h-(--control-height) w-full rounded-md border bg-surface-raised px-3 text-body text-ink placeholder:text-ink-muted disabled:bg-surface-sunken disabled:text-ink-subtle",
    options.invalid ? "border-danger" : "border-border",
    options.className,
  );
}

export function textareaClasses(options: { invalid?: boolean; className?: string } = {}): string {
  return cn(
    "min-h-24 w-full rounded-md border bg-surface-raised px-3 py-2 text-body text-ink placeholder:text-ink-muted disabled:bg-surface-sunken disabled:text-ink-subtle",
    options.invalid ? "border-danger" : "border-border",
    options.className,
  );
}

export function selectClasses(options: { invalid?: boolean; className?: string } = {}): string {
  return cn(
    "h-(--control-height) w-full rounded-md border bg-surface-raised px-3 text-body text-ink disabled:bg-surface-sunken disabled:text-ink-subtle",
    options.invalid ? "border-danger" : "border-border",
    options.className,
  );
}

export function checkboxClasses(className?: string): string {
  // accent-ink keeps the native control (and its keyboard behaviour) on-brand.
  return cn("size-5 shrink-0 rounded-sm accent-ink disabled:opacity-50", className);
}

export type AlertTone = "info" | "success" | "warning" | "danger";

const alertTones: Record<AlertTone, string> = {
  info: "bg-info-subtle text-info",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
};

export function alertClasses(tone: AlertTone, className?: string): string {
  return cn("rounded-md px-3 py-2 text-caption", alertTones[tone], className);
}
