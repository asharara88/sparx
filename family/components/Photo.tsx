"use client";
import { useEffect, useState } from "react";
import { photoUrl } from "@/lib/photos";

/** Shows a photo stored in the private bucket. */
export function Photo({ path, alt = "", className = "" }: { path: string | null; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    if (path) photoUrl(path).then((u) => live && (u ? setUrl(u) : setMissing(true)));
    return () => {
      live = false;
    };
  }, [path]);
  if (!path || missing) return null;
  if (!url) return <div className={`animate-pulse rounded-xl bg-neutral-200 ${className}`} aria-hidden />;
  return <img src={url} alt={alt} className={`rounded-xl object-cover ${className}`} onError={() => setMissing(true)} />;
}
