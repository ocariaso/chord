import { MasterUnit, type MasterUnitProps } from "./MasterUnit";
import { ZoomOverlay } from "./ZoomOverlay";

interface MasterCloseupProps extends MasterUnitProps {
  originRect: DOMRect;
  onClose: () => void;
}

/** A closer look at Master's real controls — the exact same component as the sticky header, just isolated. */
export function MasterCloseup({ originRect, onClose, ...masterProps }: MasterCloseupProps) {
  return (
    <ZoomOverlay originRect={originRect} onClose={onClose}>
      <MasterUnit {...masterProps} />
    </ZoomOverlay>
  );
}
