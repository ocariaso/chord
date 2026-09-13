# Speed and loop

Practice controls on the transport: playback speed from 0.5× to 1.25× without changing pitch, and
an A–B loop. Both are client-side, in
[`playbackEngine.ts`](../../web/src/audio/playbackEngine.ts), with the time stretch itself in an
AudioWorklet, [`stretchProcessor.js`](../../web/src/audio/stretchProcessor.js). The chips live on
the web transport in [`Transport.tsx`](../../web/src/screens/results/Transport.tsx) — the phone
transport has neither — and the state in
[`ResultsScreen.tsx`](../../web/src/screens/results/ResultsScreen.tsx).

## Speed

The speed chip opens a popover of fixed rates: 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0, 1.1 and 1.25×.
Choosing one sets `speed` at once for the label, then calls `engine.setPlaybackRate(rate)` and, when
that resolves, reads `playbackRate`, `isPlaying` and `supportsTimeStretch` back from the engine, so
the UI ends up showing what the engine actually did.

`setPlaybackRate` notes the current position, stops output if playing, sets the rate, anchors the
transport at that position and plays again if it was playing. While paused it only stores the rate,
which takes effect on the next play.

**At 1×, nothing is stretched.** `play()` starts one `AudioBufferSourceNode` per stem exactly as
before, and the worklet isn't in the path. At any other rate `play()` goes through `startStretch`,
and every stem's audio comes from a single `AudioWorkletNode` running the `chord-stretch` processor.
It has one stereo output per stem, each connected into that stem's low shelf, so tone, fader, pan,
mute, solo, the master and the [meters](metering.md) behave the same at every speed.

The time readouts stay in track time: a four-minute song reads 4:00 at 0.5× and takes eight
minutes to play.

### Where it works

`supportsTimeStretch` is true only when `AudioWorkletNode` exists, the context has an `audioWorklet`,
and the module hasn't already failed to load. Browsers expose AudioWorklet **only to secure
origins** — HTTPS, or `localhost` and `127.0.0.1` over plain HTTP. The nginx container serves plain
HTTP, so opening CHORD from another device by LAN address (a phone on the same network, say) gives
no speed control. `ResultsScreen` then passes no `onSpeedChange`, and the chip renders disabled at 45%
opacity, titled *Speed control needs HTTPS or localhost*. The same rule is why
[`clipboard.ts`](../../web/src/utils/clipboard.ts) carries a textarea fallback for *Copy log*.

On a secure origin the module can still fail to load. `addModule` is attempted once per engine (the
promise is cached); if it rejects, `stretchUnavailable` becomes true, `play()` sets the rate back to
1 and plays the buffer sources, and `ResultsScreen`'s read-back snaps the chip to 1.0× and disables
it.

### How the stretch works

The processor uses **WSOLA** (waveform-similarity overlap-add). For each output hop it computes a
nominal input position, `offset + hopIndex × hop × rate`, wrapped into the loop if one is set. It
then looks within ±15 ms of that position for the frame whose start best continues the previous
frame — measured against what the previous frame would have played next at 1×, scored by
cross-correlation normalized by the candidate's energy — and overlap-adds that frame, Hann-windowed,
onto the previous frame's tail.

| Constant | Value | Role |
| --- | --- | --- |
| `FRAME_SECONDS` | 0.06 | frame length; the hop is half of it, 30 ms. Two periodic Hann windows half a frame apart sum to exactly one, so a steady signal keeps its level |
| `SEEK_SECONDS` | 0.015 | how far from the nominal position a frame may be taken |
| `COARSE_STEP` | 4 | the first pass tests every 4th offset against every 4th sample; a second pass re-tests ±3 offsets around the winner at full resolution |
| `LOOKAHEAD_SECONDS` | 3 | how far ahead of its read position the processor asks for input |
| `REQUEST_EVERY_HOPS` | 8 | how often it re-plans those requests — every 240 ms of output |
| `RE_REQUEST_AFTER_SECONDS` | 1 | an unanswered request is sent again after this long |
| `MAX_CACHED_BLOCKS` | 12 | past this, blocks outside the current need are evicted |

Because the nominal position comes from the hop count rather than from the previous choice, the
±15 ms adjustments never add up to drift: the audio stays within 15 ms of where the transport clock
says it is.

**Every stem is cut at the same positions.** The similarity search runs once per hop, on a mix of
the stems, and all twelve channels are then read from the chosen position. Stretching each stem on
its own would choose different cut points per stem and smear them against each other in time; this
way they stay sample-aligned. The mix is weighted by what is heard: every gain change posts the
stems' fader gains to the processor, with 0 for a stem that is muted or held by a solo, so cuts
favor the stems you are listening to. With everything silenced, all stems count equally. Pan, tone
and master don't enter the weights.

The cost is on the audio rendering thread: two mix passes, the similarity search and a twelve-channel
frame read, about 33 times per second of output. Non-1× playback costs clearly more CPU than 1×,
where the browser plays buffers natively. What it doesn't cost is garbage: `process()` allocates
nothing per render quantum — it copies with indexed loops rather than `for…of` or `subarray()`
views, since a collection on the audio thread is heard as a dropout. Planning block requests, every
eighth hop, still allocates its list and the message that carries it.

### The block protocol

The processor holds no song. The decoded `AudioBuffer`s stay on the main thread, and the processor
asks for what it is about to read:

```
processor ── need [indices] ──► main thread        one block = 1 s of samples at the context rate
processor ◄── blocks ─────────  main thread        copies of every stem's two channels, transferred
```

It asks for every block its next three seconds will touch, and reads a block that hasn't arrived as
**silence** — it never waits. A main thread stalled for longer than that lookahead therefore shows up
as a dropout rather than a stutter. One block of six stereo stems at 48 kHz is about 2.3 MB of
samples, so a full cache of twelve is under 30 MB. Mono stems are sent with the one channel
duplicated.

Before starting, the main thread pushes the blocks from one second before the start position to
four seconds (times the rate) after it — and the same around the loop start, if there is one — ahead
of the start message, so the first hops aren't silent.

### Starting and restarting

`startStretch` posts `start` with `when = currentTime + 0.08 s`, the offset, rate, loop and weights.
The processor outputs silence until `currentFrame` reaches `when` and begins exactly there; the
engine anchors its clock to `when`, and `getCurrentTime()` clamps negative elapsed time to zero, so
the position holds still during the delay. The first frame is centred on the start position and only
its second half is heard, so the output at `when` is the input at the offset.

The 80 ms exists so the message reaches the audio thread before the output must sound. The cost is
an **80 ms gap on every restart at a non-1× speed** — play, seek, speed change, setting a loop,
clearing a loop — where 1× buffer sources start at `currentTime` without one. The first non-1× play
also waits for the module to load.

## A–B loop

One chip, three presses, handled by `handleLoopPress` in `ResultsScreen`:

| Press | Result | Chip |
| --- | --- | --- |
| first | marks **A** at the current position (`{start, end: null}`); playback is untouched | `Loop A 0:42`, highlighted but not pressed |
| second, under 0.5 s after A | ignored as a double press (`MIN_LOOP_SECONDS`) | unchanged |
| second | marks **B**; the loop is the earlier to the later of the two, and `engine.setLoop` jumps playback to its start | `Loop 0:42–1:10`, `aria-pressed` |
| third | `engine.clearLoop()`; playback carries on from where it is | `Loop off` |

Nothing marks A or B on the chord strip, which the design draws with its playhead alone, so the
chip's label is the only place a loop shows.

### How a loop plays

At 1× every buffer source gets `loop = true` with `loopStart` and `loopEnd`, so the wrap is native
and sample-accurate — and a **hard cut**: a loop point in the middle of a note can click. At other
speeds the processor wraps its own nominal positions into the loop, and the similarity search picks
the continuation after the wrap, so a stretched loop's seam is overlap-added across a hop rather
than cut.

The engine's position wraps the same way, so the playhead and time readouts jump back with the
audio, and `hasEnded` — which pauses playback at the end of the track — never fires while a loop is
set.

### Seeking and clearing

- Seeking inside a set loop moves within it. Seeking outside it — chord strip, seek slider or its
  keys, including End — clears the loop first.
- An A mark on its own survives seeking. Marking A, seeking back before it and pressing again gives
  a loop from the new position to A.
- Setting a loop while paused moves the paused position to the loop start.
- Clearing at 1× while playing is seamless: the sources turn `loop` off and play on, and only the
  transport anchor moves. Clearing while stretching restarts output at the current position, with
  the 80 ms gap.

## The metronome follows both

The click is scheduled ahead in short windows over the mapping between track time and audio-context
time, split at loop wraps, with beat intervals divided by the rate — so it follows loops and speed
without being rebuilt. Beats stay on the track's own grid, counted from track time zero: in a loop
that isn't a whole number of beats long, the gap across the seam is irregular, as the music's is.
See [scheduling](tempo-and-metronome.md#scheduling).

## Known gaps

- **No speed or loop on phones.** The ≤720 px transport bar has play, seek and *Click* only. A speed
  or loop set at a wider width stays in force there, with no control to change it.
- No speed control over plain HTTP from anything but `localhost`.
- Every non-1× restart has an 80 ms gap, and 1× loops wrap with a hard cut.
- Rates are a fixed list; there is no fine speed control and nothing above 1.25×.
- A loop can only be marked at the current position, not dragged out on the chord strip, and the
  strip doesn't show it.
- Neither speed nor loop is persisted, and neither has a keyboard shortcut.
- No pitch shifting: speed preserves pitch, and [transpose](transpose.md#what-it-does-not-do)
  changes chord labels, not audio.
