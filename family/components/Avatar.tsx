"use client";
import { useEffect, useState } from "react";
import { photoUrl } from "@/lib/photos";

/** A member's photo, or their initial on a soft disc. */
export function Avatar({ name, path, size = 40, className = "" }: { name: string; path?: string | null; size?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (path) photoUrl(path).then((u) => live && setUrl(u ?? null));
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {url ? <img src={url} alt="" /> : name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
