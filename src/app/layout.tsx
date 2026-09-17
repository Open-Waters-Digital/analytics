import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Open Waters Analytics", template: "%s · Open Waters Analytics" },
  // Internal tool: nothing here should ever be indexed. The X-Robots-Tag
  // header in next.config.ts covers non-HTML responses too.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
