import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Moataz Agent Platform",
    template: "%s | Moataz Agent Platform",
  },
  description: "منصة SaaS عربية متعددة المؤسسات لبناء وتشغيل وإدارة وكلاء الذكاء الاصطناعي بأمان.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
