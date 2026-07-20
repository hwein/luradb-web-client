interface LogoMarkProps {
  size: number
}

/** Markenzeichen „Slipstream Engines" (design-concept/logo): drei Layer in REL/JSON/KV, Neigung fix −14°. */
export function LogoMark({ size }: LogoMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
      <g transform="skewX(-14)">
        <rect x="32" y="22" width="52" height="13" rx="6.5" fill="var(--logo-rel)" />
        <rect x="32" y="42" width="52" height="13" rx="6.5" fill="var(--logo-json)" />
        <rect x="32" y="62" width="52" height="13" rx="6.5" fill="var(--logo-kv)" />
      </g>
    </svg>
  )
}
