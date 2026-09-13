import {
  MAX_TRANSPOSE,
  MIN_TRANSPOSE,
  type PlayerState,
  type ResultView,
  type StemKey,
  type StemState,
} from "../../design/player";

export type PlayerAction =
  | { type: "stemsLoaded"; stems: StemState[]; duration: number }
  | { type: "stemChanged"; key: StemKey; change: Partial<Omit<StemState, "key">> }
  | { type: "viewChanged"; view: ResultView }
  | { type: "masterChanged"; master: number }
  | { type: "transposeChanged"; transpose: number }
  | { type: "metronomeChanged"; metronome: boolean }
  | { type: "playingChanged"; playing: boolean };

export const INITIAL_PLAYER: PlayerState = {
  view: "mixer",
  playing: false,
  duration: 0,
  master: 1,
  transpose: 0,
  metronome: false,
  stems: [],
};

/**
 * The template's PlayerState, changed in one place. An action that changes nothing returns the same state,
 * so it costs no render.
 */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "stemsLoaded":
      return {
        ...state,
        duration: action.duration,
        // A retry reloads only the stems that failed; the ones already on the mixer keep their settings.
        stems: action.stems.map((stem) => state.stems.find((current) => current.key === stem.key) ?? stem),
      };
    case "stemChanged":
      return {
        ...state,
        stems: state.stems.map((stem) => (stem.key === action.key ? { ...stem, ...action.change } : stem)),
      };
    case "viewChanged":
      return { ...state, view: action.view };
    case "masterChanged":
      return { ...state, master: action.master };
    case "transposeChanged":
      return { ...state, transpose: Math.max(MIN_TRANSPOSE, Math.min(MAX_TRANSPOSE, action.transpose)) };
    case "metronomeChanged":
      return { ...state, metronome: action.metronome };
    case "playingChanged":
      return action.playing === state.playing ? state : { ...state, playing: action.playing };
  }
}
