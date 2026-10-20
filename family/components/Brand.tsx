/**
 * elnunu (النونو): the mark is the Arabic letter noon drawn as an ivory cradle
 * with the little one above it in apricot, on plum. The wordmark is "nunu",
 * big and plum; "el" (or "ال") is small and apricot in front of it.
 * The mark is inline SVG so it inherits size and never loads.
 */
export function Mark({ size = 32, className = "", title = "elnunu" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id="elnunu-plum" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5C2A4E" />
          <stop offset="1" stopColor="#43193A" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#elnunu-plum)" />
      <path d="M120 236 a136 136 0 0 0 272 0" fill="none" stroke="#FFF9F0" strokeWidth="60" strokeLinecap="round" />
      <circle cx="256" cy="154" r="42" fill="#F29B78" />
    </svg>
  );
}

/** The Latin name: small apricot "el", big plum "nunu". */
export function Name({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`wordmark ${className}`} style={style} lang="en">
      <span className="wordmark-el">el</span>
      <span className="wordmark-nunu">nunu</span>
    </span>
  );
}

/** The Arabic name, same scheme: small apricot "ال", big plum "نونو". One run, so the letters stay joined. */
export function NameArabic({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`wordmark-ar ${className}`} style={style} lang="ar" dir="rtl">
      <span className="wordmark-el">ال</span>
      <span className="wordmark-nunu">نونو</span>
    </span>
  );
}

/** Mark plus the Latin name. `size` is the mark; the name scales with it. */
export function Wordmark({ size = 28, className = "", arabic = false }: { size?: number; className?: string; arabic?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark size={size} />
      <Name style={{ fontSize: size * 0.9 }} />
      {arabic && <NameArabic style={{ fontSize: size * 0.8 }} />}
    </span>
  );
}
