export const AMP_WIDTH = 480;
export const GRID_GAP = 24;
export const MASTER_WIDTH = AMP_WIDTH * 2 + GRID_GAP;

export const CABINET_PADDING_X = 22;
export const CABINET_POST_WIDTH = 30;
export const CABINET_GAP = 14;
export const CABINET_BEZEL_PADDING = 14;
export const CABINET_WIDTH =
  MASTER_WIDTH + CABINET_BEZEL_PADDING * 2 + CABINET_GAP * 2 + CABINET_POST_WIDTH * 2 + CABINET_PADDING_X * 2;

// The cabinet's velvet-lined interior, like the inside of an instrument case.
export const CABINET_INTERIOR_COLOR = "#122019";
export const CABINET_INTERIOR_IMAGE =
  "radial-gradient(circle at 25% 15%, rgba(255,255,255,0.05), transparent 55%), linear-gradient(160deg, #17301f 0%, #102319 55%, #0a1811 100%)";
