import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "My New Job",
  description: "משרות פתוחות שמתאימות לי, מדורגות לפי אחוז התאמה",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            My New Job
          </Link>
          <nav>
            <Link href="/">משרות</Link>
            <Link href="/settings">הגדרות</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
