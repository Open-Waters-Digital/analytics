import { describe, expect, it } from "vitest";
import { decide, isPublicPath } from "./proxy-policy";

describe("isPublicPath", () => {
  it.each([
    "/sign-in",
    "/sign-in/check-email",
    "/api/auth/magic-link/verify",
    "/api/health",
    "/_next/static/chunks/app.js",
    "/favicon.ico",
    "/robots.txt",
  ])("%s is public", path => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/design-system",
    "/clients",
    "/sign-inside",
    "/api/healthz",
    "/api/authx",
    "/api/other",
  ])("%s is protected", path => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("decide", () => {
  it("redirects a signed-out visit to sign in, remembering where it was going", () => {
    expect(decide("/design-system", "?tab=type", false)).toEqual({
      kind: "redirect",
      location: "/sign-in?returnTo=%2Fdesign-system%3Ftab%3Dtype",
    });
  });

  it("does not add returnTo for the home page", () => {
    expect(decide("/", "", false)).toEqual({ kind: "redirect", location: "/sign-in" });
  });

  it("lets a request with a session cookie through for the real check", () => {
    expect(decide("/design-system", "", true)).toEqual({ kind: "continue" });
  });

  it("never redirects public paths", () => {
    expect(decide("/api/health", "", false)).toEqual({ kind: "continue" });
    expect(decide("/sign-in", "", false)).toEqual({ kind: "continue" });
  });
});
