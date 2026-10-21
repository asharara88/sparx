import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  metadataBase: new URL("https://elnunu.com"),
  title: "elnunu",
  description: "elnunu: care, together. A shared view of your baby's day: the little one's log, the helper, who is home, and the house.",
  manifest: "/manifest.webmanifest",
  applicationName: "elnunu",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "elnunu" },
  icons: {
    icon: [
      { url: "/brand/mark.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fff9f0" }, { media: "(prefers-color-scheme: dark)", color: "#2a1526" }],
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
