import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Near Me Search",
  description: "Find nearby services around your location",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
