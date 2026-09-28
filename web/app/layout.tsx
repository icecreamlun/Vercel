import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PromptShip — Ship with evidence",
  description:
    "A release pipeline for AI prompts. Compare behavior, investigate regressions, and promote with confidence.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
