import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterSW } from "@/components/RegisterSW";
import { ViewportVars } from "@/components/ViewportVars";

/**
 * The launch screen an installed iPhone shows while the app starts (public/splash/: the mark
 * on the page colour), one per iPhone screen, portrait. Without these it is a white flash.
 * [file size, CSS width, CSS height, pixel ratio]
 */
const LAUNCH: [string, number, number, number][] = [
  ["750x1334", 375, 667, 2],
  ["1242x2208", 414, 736, 3],
  ["1125x2436", 375, 812, 3],
  ["828x1792", 414, 896, 2],
  ["1242x2688", 414, 896, 3],
  ["1170x2532", 390, 844, 3],
  ["1284x2778", 428, 926, 3],
  ["1179x2556", 393, 852, 3],
  ["1290x2796", 430, 932, 3],
  ["1206x2622", 402, 874, 3],
  ["1320x2868", 440, 956, 3]
];

export const metadata: Metadata = {
  metadataBase: new URL("https://elnunu.com"),
  title: "elnunu",
  description: "elnunu: care, together. A shared view of your baby's day: one-tap logging, a helper you can talk to, and everyone who looks after your baby on the same page.",
  manifest: "/manifest.webmanifest",
  applicationName: "elnunu",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "elnunu",
    startupImage: LAUNCH.map(([size, w, h, r]) => ({ url: `/splash/launch-${size}.png`, media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)` })),
  },
  // iPhone turns times, amounts and dates in the text into phone links and calendar links;
  // the app's own call buttons are real tel: links.
  formatDetection: { telephone: false, date: false, address: false, email: false },
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
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fff4f6" }, { media: "(prefers-color-scheme: dark)", color: "#2a1526" }],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <RegisterSW />
        <ViewportVars />
      </body>
    </html>
  );
}
