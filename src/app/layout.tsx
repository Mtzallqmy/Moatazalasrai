import type { Metadata } from "next";
import "./globals.css";
import "./typography.css";

export const metadata: Metadata = {
  title: {
    default: "معتز AI — منصة الوكلاء الذكية",
    template: "%s | معتز AI",
  },
  description: "منصة SaaS عربية متعددة المؤسسات لبناء وتشغيل وإدارة وكلاء الذكاء الاصطناعي بأمان.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{const t=localStorage.getItem("moataz-theme");document.documentElement.dataset.theme=t||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch{}` }} />
      </head>
      <body><a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>{children}</body>
    </html>
  );
}
