import { resultsCopy } from "../../design/copy";

interface RoutingTogglesProps {
  /** The stem's display name, for the buttons' accessible names. */
  stem: string;
  muted: boolean;
  solo: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
}

/** The MUTE / SOLO pair: real buttons with `aria-pressed`. The parent supplies the row they sit in. */
export function RoutingToggles({ stem, muted, solo, onToggleMute, onToggleSolo }: RoutingTogglesProps) {
  return (
    <>
      <button
        type="button"
        className={muted ? "ch-toggle is-on-muted" : "ch-toggle"}
        aria-pressed={muted}
        aria-label={resultsCopy.muteLabel(stem)}
        onClick={onToggleMute}
      >
        {resultsCopy.mute}
      </button>
      <button
        type="button"
        className={solo ? "ch-toggle is-on" : "ch-toggle"}
        aria-pressed={solo}
        aria-label={resultsCopy.soloLabel(stem)}
        onClick={onToggleSolo}
      >
        {resultsCopy.solo}
      </button>
    </>
  );
}
