// Lumi's face: used on the welcome orb, how-to, and ready screens. Pure SVG, no state.
export default function Face({ className = '' }) {
  return (
    <svg className={`st-face ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="22" cy="58" r="7" fill="#FF6B4A" opacity=".4" /><circle cx="78" cy="58" r="7" fill="#FF6B4A" opacity=".4" />
      <g className="st-eye"><ellipse cx="36" cy="44" rx="5" ry="7" fill="#2b1b3d" /><circle cx="38" cy="41" r="1.8" fill="#fff" /></g>
      <g className="st-eye"><ellipse cx="64" cy="44" rx="5" ry="7" fill="#2b1b3d" /><circle cx="66" cy="41" r="1.8" fill="#fff" /></g>
      <path d="M37 59 Q50 75 63 59" fill="none" stroke="#2b1b3d" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  )
}
