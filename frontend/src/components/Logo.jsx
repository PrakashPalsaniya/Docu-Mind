// DocuMind brand mark: a document whose content is a small neural graph.
// Inline SVG so it stays sharp at any size and inherits color from props.
// variants: "tile" (gradient tile), "plain", "plain-white".
export default function Logo({ className = "w-8 h-8", variant = "tile" }) {
  const gradId = "documind-grad";
  const ink =
    variant === "tile"
      ? "#ffffff"
      : variant === "plain-white"
      ? "#ffffff"
      : `url(#${gradId})`;

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="DocuMind logo"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="0.55" stopColor="#6366f1" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>

      {/* Rounded gradient tile (skipped for the "plain" variant) */}
      {variant === "tile" && (
        <rect x="0" y="0" width="48" height="48" rx="12" fill={`url(#${gradId})`} />
      )}

      {/* Document with a folded top-right corner */}
      <g
        stroke={ink}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M14 11h13l7 7v19a1 1 0 0 1-1 1H14a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1Z" />
        <path d="M27 11v7h7" />

        {/* Neural graph = the "Mind" reading the page */}
        <g fill={ink} strokeWidth="1.8">

          {/* connections */}
          <path d="M19 30l5-6 5 4" fill="none" />
          <path d="M24 24l0-1.5" fill="none" />
          {/* nodes */}
          <circle cx="19" cy="30" r="2.4" />
          <circle cx="24" cy="24" r="2.4" />
          <circle cx="29" cy="28" r="2.4" />
        </g>
      </g>
    </svg>
  );
}
