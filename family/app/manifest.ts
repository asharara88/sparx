import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "elnunu",
    short_name: "elnunu",
    description: "Care, together. A shared view of your baby's day.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff4f6",
    theme_color: "#4b203f",
    shortcuts: [
      { name: "Sleep timer", short_name: "Sleep", url: "/baby/quick/sleep", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Feed", short_name: "Feed", url: "/baby/quick/feed", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Log a nappy", short_name: "Nappy", url: "/baby/log/diaper", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Ask the helper", short_name: "Ask", url: "/ask", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
