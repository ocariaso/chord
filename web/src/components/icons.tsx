interface IconProps {
  size?: number;
}

export function UploadIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M12 16V4" strokeLinecap="round" />
      <path d="M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ size = 12 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function PlayIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l14-7.5z" />
    </svg>
  );
}

export function PauseIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
    </svg>
  );
}

export function MetronomeIcon({ size = 12 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M12 3l7 17H5z" strokeLinejoin="round" />
      <path d="M12 7l3 10" strokeLinecap="round" />
    </svg>
  );
}

export function StopIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" strokeLinejoin="round" />
    </svg>
  );
}

export function AlertIcon({ size = 20 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M12 6v8" strokeLinecap="round" />
      <path d="M12 18v.01" strokeLinecap="round" strokeWidth={2.6} />
    </svg>
  );
}

/** The stage list's tick; stroked in `color`, transparent for stages not yet done. */
export function CheckIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={10} height={10} fill="none" strokeWidth={3} style={{ stroke: color }} aria-hidden="true">
      <path d="M5 13l4 4 10-11" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
