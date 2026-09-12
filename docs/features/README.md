# Features

One page per user-visible capability, each tracing the whole path from input to pixels.

| Feature | Server entry point | Web entry point |
| --- | --- | --- |
| [Ingest](ingest.md) — upload a file or paste a link | [`routes_jobs.py`](../../server/app/api/routes_jobs.py), [`source.py`](../../server/app/pipeline/source.py) | [`UploadPanel.tsx`](../../web/src/components/UploadPanel.tsx) |
| [Stem separation](stem-separation.md) — six isolated tracks | [`separation.py`](../../server/app/pipeline/separation.py) | [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) |
| [Chords and key](chords-and-key.md) | [`chords.py`](../../server/app/pipeline/chords.py) | [`ChordTimeline.tsx`](../../web/src/components/ChordTimeline.tsx) |
| [Tempo and metronome](tempo-and-metronome.md) | [`tempo.py`](../../server/app/pipeline/tempo.py) | [`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts) |
| [Lyrics](lyrics.md) — synced, offset-corrected | [`lyrics.py`](../../server/app/pipeline/lyrics.py) | [`useLyrics.ts`](../../web/src/hooks/useLyrics.ts) |
| [Theming](theming.md) — accent colors from cover art | [`thumbnail.py`](../../server/app/pipeline/thumbnail.py) | [`useDominantColor.ts`](../../web/src/hooks/useDominantColor.ts) |
| [Simple view](simple-view.md) — the default mixer | — | [`StemMixer.tsx`](../../web/src/components/StemMixer.tsx) |
| [Studio view](studio-view.md) — the amp rack | — | [`studio/`](../../web/src/components/studio/) |
| [Transpose](transpose.md) | — | [`transpose.ts`](../../web/src/utils/transpose.ts) |
| [Downloads](downloads.md) — per stem or zip | [`routes_stems.py`](../../server/app/api/routes_stems.py) | [`download.ts`](../../web/src/utils/download.ts) |
| [Progress and cancellation](../architecture/job-lifecycle.md) | [`routes_jobs.py`](../../server/app/api/routes_jobs.py) | [`ProcessingScreen.tsx`](../../web/src/components/ProcessingScreen.tsx) |

## The user's path through them

```
paste a link ─┐
              ├─► processing screen ─► mixer ─┬─► Simple view  (chords, lyric line, waveforms)
drop a file ──┘   (live progress,             │
                   cancellable)               └─► Studio view  (amp rack, tap to zoom)
                                                     │
                                   both: play/pause, seek, mute, solo, per-stem and
                                   master volume, metronome, transpose, download
```

## What is deliberately absent

- No library or history — a finished job is deleted when you leave it
  ([why](../architecture/decisions.md#discard-on-leave)).
- No accounts, sessions, or per-user scoping.
- No pitch shifting: transpose changes the *labels*, not the audio
  ([why](transpose.md#what-it-does-not-do)).
- No tempo stretching or loop/practice sections.
- No beat grid — the metronome derives clicks from BPM alone, not from detected downbeats
  ([why](tempo-and-metronome.md#phase-alignment)).
