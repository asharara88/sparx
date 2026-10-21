import type { MetadataRoute } from "next";

/** A family's private log. Nothing here is for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
