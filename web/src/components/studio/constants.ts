export const AMP_WIDTH = 480;
// In controls-only mode (mobile), an amp's row doesn't need its full desktop width to stay
// readable — the waveform just fills whatever's left — so it uses this narrower native width
// instead, matching Master's mobile width for a consistent stacked column.
export const AMP_MOBILE_WIDTH = 340;
export const GRID_GAP = 24;
export const MASTER_WIDTH = AMP_WIDTH * 2 + GRID_GAP;

export const CABINET_PADDING_X = 22;
export const CABINET_POST_WIDTH = 30;
export const CABINET_GAP = 14;
export const CABINET_BEZEL_PADDING = 14;
export const CABINET_WIDTH =
  MASTER_WIDTH + CABINET_BEZEL_PADDING * 2 + CABINET_GAP * 2 + CABINET_POST_WIDTH * 2 + CABINET_PADDING_X * 2;

// The cabinet's decorative chrome (posts, rails, bezel) is fixed-pixel by design; on a phone that
// same chrome would eat most of the available width, so it shrinks to a slimmer mobile variant.
export const CABINET_PADDING_X_MOBILE = 8;
export const CABINET_POST_WIDTH_MOBILE = 14;
export const CABINET_GAP_MOBILE = 8;
export const CABINET_BEZEL_PADDING_MOBILE = 8;

// Master's dense header row can't reflow to fit 984px into a phone screen, so on mobile it uses
// its own, narrower native design width instead (still shrunk further by ScaleToFit if needed).
export const MASTER_MOBILE_WIDTH = 340;

// The cabinet's velvet-lined interior, like the inside of an instrument case.
export const CABINET_INTERIOR_COLOR = "#122019";
export const CABINET_INTERIOR_IMAGE =
  "radial-gradient(circle at 25% 15%, rgba(255,255,255,0.05), transparent 55%), linear-gradient(160deg, #17301f 0%, #102319 55%, #0a1811 100%)";
