import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "elnunu · النونو",
  description: "elnunu (النونو): the little one's day, in everyone's hands. Lana's log, the helper, who is home, and the house.",
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
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fbf6f0" }, { media: "(prefers-color-scheme: dark)", color: "#1c1714" }],
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
