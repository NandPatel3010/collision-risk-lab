import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Collision Risk Lab",
  description: "Estimate an approaching object's time to contact with your laptop camera.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
