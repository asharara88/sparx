import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "Our home",
  description: "Private family app: Lana's log, who is home, and the household list.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Our home" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f4f7" }, { media: "(prefers-color-scheme: dark)", color: "#0f1013" }],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
