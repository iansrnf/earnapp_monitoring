import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Earnapp Devices",
  description: "Earnapp device list, usage forecast, and delete tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
