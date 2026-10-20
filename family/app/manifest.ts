import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "elnunu",
    short_name: "elnunu",
    description: "Care, together. A shared view of your baby's day.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff9f0",
    theme_color: "#4b203f",
    shortcuts: [
      { name: "Sleep timer", short_name: "Sleep", url: "/lana/quick/sleep", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Log a feed", short_name: "Feed", url: "/lana/log/feed", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Log a diaper", short_name: "Diaper", url: "/lana/log/diaper", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Ask the helper", short_name: "Ask", url: "/ask", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
