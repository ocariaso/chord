import { BassAmp } from "./amps/BassAmp";
import { DrumsAmp } from "./amps/DrumsAmp";
import { GuitarAmp } from "./amps/GuitarAmp";
import { OtherAmp } from "./amps/OtherAmp";
import { PianoAmp } from "./amps/PianoAmp";
import { VocalsAmp } from "./amps/VocalsAmp";
import type { AmpProps } from "./types";

export const AMP_COMPONENTS: Record<string, (props: AmpProps) => React.JSX.Element> = {
  vocals: VocalsAmp,
  guitar: GuitarAmp,
  bass: BassAmp,
  piano: PianoAmp,
  drums: DrumsAmp,
  other: OtherAmp,
};

export const STEM_ORDER = ["vocals", "guitar", "bass", "drums", "piano", "other"];
