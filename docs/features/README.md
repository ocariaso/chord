# Features

One page per user-visible capability, each tracing the whole path from input to pixels. What the
screens look like and say follows the design template in [`web/template/`](../../web/template/);
see [../conventions/design.md](../conventions/design.md).

| Feature | Server entry point | Web entry point |
| --- | --- | --- |
| [Ingest](ingest.md) — upload a file or paste a link | [`routes_jobs.py`](../../server/app/api/routes_jobs.py), [`source.py`](../../server/app/pipeline/source.py) | [`LandingScreen.tsx`](../../web/src/screens/landing/LandingScreen.tsx) |
| [Stem separation](stem-separation.md) — six isolated tracks | [`separation.py`](../../server/app/pipeline/separation.py) | [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) |
| [Results views](results-views.md) — Mixer, Console and Analog over one state | — | [`ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx), [`screens/results/`](../../web/src/screens/results/) |
| [Metering](metering.md) — peak, true peak, loudness, correlation | — | [`meters.ts`](../../web/src/audio/meters.ts) |
| [Speed and loop](speed-and-loop.md) — pitch-preserving speed, A–B loop | — | [`stretchProcessor.js`](../../web/src/audio/stretchProcessor.js) |
| [Chords and key](chords-and-key.md) | [`chords.py`](../../server/app/pipeline/chords.py) | [`ChordBar.tsx`](../../web/src/screens/results/ChordBar.tsx) |
| [Tempo and metronome](tempo-and-metronome.md) | [`tempo.py`](../../server/app/pipeline/tempo.py) | [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) |
| [Lyrics](lyrics.md) — synced and offset-corrected, or pasted | [`lyrics.py`](../../server/app/pipeline/lyrics.py), [`routes_analysis.py`](../../server/app/api/routes_analysis.py) | [`useLyrics.ts`](../../web/src/hooks/useLyrics.ts), [`LyricsDialog.tsx`](../../web/src/screens/results/LyricsDialog.tsx) |
| [Transpose](transpose.md) | — | [`AnalysisBar.tsx`](../../web/src/screens/results/AnalysisBar.tsx), [`transpose.ts`](../../web/src/utils/transpose.ts) |
| [Downloads](downloads.md) — the export dialog, per stem or zip | [`routes_stems.py`](../../server/app/api/routes_stems.py) | [`ExportDialog.tsx`](../../web/src/screens/results/ExportDialog.tsx) |
| [Theming](theming.md) — the fixed palette, stem hues, cover art | [`thumbnail.py`](../../server/app/pipeline/thumbnail.py) | [`chord-theme.css`](../../web/src/styles/chord-theme.css), [`CoverArt.tsx`](../../web/src/components/CoverArt.tsx) |
| [Progress, cancellation and resume](../architecture/job-lifecycle.md) | [`routes_jobs.py`](../../server/app/api/routes_jobs.py), [`pipeline.py`](../../server/app/pipeline/pipeline.py) | [`ProcessingScreen.tsx`](../../web/src/screens/processing/ProcessingScreen.tsx), [`FailurePanel.tsx`](../../web/src/screens/failure/FailurePanel.tsx) |

## The user's path through them

```
paste a link ─┐                                                   ┌─► Mixer    default; the only view at ≤720px
              ├─► processing ──► stems load ──► results screen ───┼─► Console  vertical faders, meters
drop a file ──┘   live progress,  in the          │               └─► Analog   knobs, needle meters
                  cancel, resume  browser         │
                        │                         └─ shared by all three: play, seek, speed, A–B loop,
                        │                            mute, solo, levels, master, metronome, transpose,
                        │                            chords, lyrics, export — no speed or loop at ≤720px
                        │
                        └─► failure panel: job error, cancelled (resume or discard), connection lost,
                                           job not found, stems failed to load
```

## What is deliberately absent

- No library or history — a finished job is deleted when you leave it
  ([why](../architecture/decisions.md#discard-on-leave)).
- No accounts, sessions, or per-user scoping.
- No pitch shifting. Speed changes tempo with pitch preserved, and transpose changes the chord
  *labels*, not the audio ([why](transpose.md#what-it-does-not-do)).
- No beat grid — the metronome derives clicks from BPM alone, not from detected downbeats
  ([why](tempo-and-metronome.md#phase-alignment)).
- No rendered mix. Exports are the stems as separated; level, pan, tone and mute are not applied
  ([details](downloads.md#what-isnt-offered)).
- No saved mixer settings — view, levels, transpose, speed and loop reset when you leave a job.
