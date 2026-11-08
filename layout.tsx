import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Cloud",
  description: "فضای ابری شخصی شما",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body>{children}</body></html>;
}
