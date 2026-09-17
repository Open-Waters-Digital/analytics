/**
 * Brand colours as literal values, for the few places that cannot read a CSS
 * variable: email templates (mail clients ignore stylesheets) and, later, OG
 * images or <meta name="theme-color">. Each mirrors a token in
 * src/styles/tokens.css; change both together. The one file outside the token
 * layer that ESLint allows literal colours in.
 */
export const BRAND_INK = "#0b0b0c";
export const BRAND_INK_MUTED = "#565a63";
