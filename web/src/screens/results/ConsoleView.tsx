import { useLayoutEffect, useRef } from "react";
import { LevelFollower } from "../../audio/meters";
import { createMeterReadings, type MeterReadings } from "../../audio/playbackEngine";
import { MASTER_METER_SCALE, STEM_METER_SCALE } from "../../design/player";
import { useAnimationFrame } from "../../hooks/useAnimationFrame";
import { formatDb, mapThroughAnchors } from "../../utils/levels";
import { ConsoleStrip } from "./ConsoleStrip";
import { MASTER_METER, MasterStrip } from "./MasterStrip";
import type { StemControls, StemDisplay } from "./types";

const METER_RELEASE_DB_PER_SECOND = 24;
const PEAK_HOLD_MS = 1500;
// Numbers redrawn at 60 fps can't be read; the bars move every frame, the text eight times a second.
const READOUT_INTERVAL_MS = 125;

interface ConsoleViewProps {
  stems: StemDisplay[];
  controls: StemControls;
  master: number;
  onMasterChange: (value: number) => void;
  metronome: boolean;
  onExport: () => void;
  readMeters: (target: MeterReadings, now: number) => void;
}

/** The Console view: a scrolling row of strips and the master strip. The meters bypass React, written each frame (design.md#metering). */
export function ConsoleView({ stems, controls, master, onMasterChange, metronome, onExport, readMeters }: ConsoleViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLSpanElement>(null);
  const meterElementsRef = useRef<HTMLElement[]>([]);
  const readingsRef = useRef(createMeterReadings());
  const followersRef = useRef(new Map<HTMLElement, LevelFollower>());
  const peakFollowerRef = useRef(new LevelFollower(METER_RELEASE_DB_PER_SECOND, PEAK_HOLD_MS));
  const lastReadoutRef = useRef(0);
  const anySolo = stems.some((stem) => stem.state.solo);

  useLayoutEffect(() => {
    meterElementsRef.current = [...(containerRef.current?.querySelectorAll<HTMLElement>("[data-meter]") ?? [])];
  }, [stems.length]);

  useAnimationFrame(true, (now) => {
    const readings = readingsRef.current;
    readMeters(readings, now);
    for (const element of meterElementsRef.current) {
      const source = element.dataset.meter!;
      const channel = Number(element.dataset.channel);
      const peak = source === MASTER_METER ? readings.master[channel] : (readings.stems[source]?.[channel] ?? 0);
      let follower = followersRef.current.get(element);
      if (!follower) {
        follower = new LevelFollower(METER_RELEASE_DB_PER_SECOND);
        followersRef.current.set(element, follower);
      }
      const scale = source === MASTER_METER ? MASTER_METER_SCALE : STEM_METER_SCALE;
      element.style.setProperty("--l", mapThroughAnchors(follower.update(peak, now), scale).toFixed(3));
    }
    const peakDb = peakFollowerRef.current.update(readings.truePeak, now);
    if (peakRef.current && now - lastReadoutRef.current >= READOUT_INTERVAL_MS) {
      lastReadoutRef.current = now;
      peakRef.current.textContent = formatDb(peakDb);
    }
  });

  return (
    <div
      ref={containerRef}
      className="flex items-stretch"
      style={{
        gap: "var(--space-8)",
        padding: "var(--space-8)",
        minHeight: 330,
        boxShadow: "inset 0 -1px 0 color-mix(in srgb, var(--color-text) 8%, transparent)",
      }}
    >
      <div className="ch-striprow">
        {stems.map((stem) => (
          <ConsoleStrip key={stem.state.key} stem={stem} anySolo={anySolo} controls={controls} />
        ))}
      </div>
      <span className="ch-divider-x" />
      <MasterStrip master={master} onMasterChange={onMasterChange} metronome={metronome} onExport={onExport} peakRef={peakRef} />
    </div>
  );
}
