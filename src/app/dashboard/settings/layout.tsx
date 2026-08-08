import Link from "next/link";
import type { ReactNode } from "react";
import { Braces, Settings } from "lucide-react";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <>
    <nav className="settings-subnav" aria-label="أقسام الإعدادات">
      <Link href="/dashboard/settings"><Settings size={15} /> الإعدادات العامة</Link>
      <Link href="/dashboard/settings/developer-mode"><Braces size={15} /> تفاصيل المطور</Link>
    </nav>
    {children}
  </>;
}
