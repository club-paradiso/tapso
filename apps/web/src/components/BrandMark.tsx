/**
 * The TAPSO mark: 돌이's basalt squircle with the tangerine destination dot.
 * Drawn in SVG so it stays sharp at every size and costs no image request.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="3" width="28" height="27" rx="9" fill="var(--basalt)" />
      <rect x="8.5" y="7.5" width="13" height="3" rx="1.5" fill="var(--mint)" />
      <circle cx="11.5" cy="16.5" r="1.6" fill="#fff" />
      <circle cx="18.5" cy="16.5" r="1.6" fill="#fff" />
      <path d="M12.5 21.2 Q15 24 17.5 21.2" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="26" cy="5.5" r="4.5" fill="var(--tangerine)" />
    </svg>
  );
}
