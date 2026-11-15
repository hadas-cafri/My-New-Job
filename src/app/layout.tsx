import type { Metadata, Viewport } from "next";
import { ConnectionProvider } from "@/components/ConnectionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "My New Job",
  description: "משרות פתוחות שמתאימות לי, מדורגות לפי אחוז התאמה",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <header className="topbar">
          <span className="brand">My New Job</span>
        </header>
        <main>
          <ConnectionProvider>{children}</ConnectionProvider>
        </main>
      </body>
    </html>
  );
}
