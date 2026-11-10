import type { MetadataRoute } from "next";

/** A family's private log: only the landing page is for search engines, nothing behind it. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: ["/welcome$", "/welcome/"], disallow: "/" } };
}
