/**
 * Bambino: the mark (a rounded b with a moon in its bowl, on warm clay) and
 * the wordmark. The mark is inline SVG so it inherits size and never loads.
 */
export function Mark({ size = 32, className = "", title = "Bambino" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} role="img" aria-label={title}>
      <defs>
        <linearGradient id="bambino-clay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F0885B" />
          <stop offset="1" stopColor="#D45F3A" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="128" fill="url(#bambino-clay)" />
      <path d="M176 112 v232" fill="none" stroke="#FFF7F1" strokeWidth="64" strokeLinecap="round" />
      <circle cx="276" cy="326" r="90" fill="none" stroke="#FFF7F1" strokeWidth="64" />
      <path d="M296 282 a44 44 0 1 0 0 88 a36 36 0 1 1 0 -88 z" fill="#FFF7F1" />
    </svg>
  );
}

/** Mark plus the name. `size` is the mark; the name scales with it. */
export function Wordmark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark size={size} />
      <span className="wordmark" style={{ fontSize: size * 0.85 }}>
        bambino
      </span>
    </span>
  );
}
