/** The list robot, looking around with a magnifying glass. Motion stops when the user asks for it. */
export function SearchSplash({ className = 'size-40' }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} fill="none" aria-hidden>
      <circle className="v2-search-pulse" cx="90" cy="88" r="16" stroke="currentColor" strokeWidth="1.5" />
      <circle
        className="v2-search-pulse"
        cx="90"
        cy="88"
        r="16"
        stroke="currentColor"
        strokeWidth="1.5"
        style={{ animationDelay: '0.55s' }}
      />
      <line x1="58" y1="22" x2="58" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="58" cy="10" r="3.5" fill="currentColor" />
      <rect x="28" y="22" width="60" height="52" rx="16" stroke="currentColor" strokeWidth="2.5" />
      <rect x="18" y="38" width="10" height="16" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <rect x="88" y="38" width="10" height="16" rx="4" stroke="currentColor" strokeWidth="2.5" />
      <g className="v2-search-eyes">
        <circle cx="46" cy="46" r="4" fill="currentColor" />
        <circle cx="70" cy="46" r="4" fill="currentColor" />
      </g>
      <path d="M48 60h20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <g className="v2-search-glass">
        <circle cx="90" cy="88" r="16" stroke="currentColor" strokeWidth="2.5" />
        <line x1="102" y1="100" x2="116" y2="114" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}
