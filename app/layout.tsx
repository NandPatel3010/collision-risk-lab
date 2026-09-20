import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Collision Risk Lab",
  description: "Explore 2D collision scenarios and estimate object approach using your laptop camera.",
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
