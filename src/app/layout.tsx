import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moataz AI Platform",
  description:
    "Production-grade full-stack starter: Next.js + Neon + Drizzle, portable across Cloudflare, Railway, and any Node/Docker host.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
