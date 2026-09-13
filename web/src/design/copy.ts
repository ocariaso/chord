/**
 * Every string the screens render.
 *
 * The design template (web/template) is the source of truth for copy. Strings are verbatim from
 * `CHORD Template.dc.html` unless they sit under an "App-authored" comment, which marks states the
 * template doesn't show; keep those minimal and in the template's voice. Two template lines are reworded
 * by decision because they described behavior the app doesn't have — each is marked where it lives. Stage
 * messages double as the API's `stage_message` values, so they must never be edited here alone.
 * See docs/conventions/design.md.
 */

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

/** "three" for 3, as the template's failure copy writes counts. */
export function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/** "about 40 seconds left", "about 3 minutes left" — rounded, because the estimate is rough. */
function remaining(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds left`;
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
}

export const brand = {
  name: "CHORD",
  expansion: "Component Harmony & Orchestral Retrieval Decoder",
} as const;

export const stemNames = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  piano: "Piano",
  other: "Other",
} as const;

export const landingCopy = {
  headline: "Split any track into stems, chords and key.",
  intro:
    "Drop a lossless file or paste a link. CHORD returns six isolated stems, a chord chart aligned to the beat, detected key and tempo, and synced lyrics where it can find them.",
  dropTitle: "Drop an audio file, or choose one",
  // "up to 12 minutes" is the server's MAX_DURATION_SECONDS default.
  dropHint: "MP3 or FLAC · up to 12 minutes · 44.1 / 48 kHz preserved through separation",
  phoneDropTitle: "Choose an audio file",
  phoneDropHint: "MP3 or FLAC · up to 12 minutes",
  chooseFile: "Choose file",
  orPasteLink: "or paste a link",
  urlLabel: "Track URL",
  urlPlaceholder: "https://",
  fetchTrack: "Fetch track",
  submitting: "Submitting…",
  stemsHint: "Six stems: vocals · drums · bass · guitar · piano · other",
  rejectedDropTitle: (fileName: string) => `${fileName} was rejected`,
  rejectedDropHint: "CHORD reads MP3 and FLAC only",
  rejectedTitle: "Rejected file",
  rejectedBody: (fileName: string) =>
    `${fileName} isn't supported. CHORD reads MP3 and FLAC; convert to FLAC to keep the full dynamic range.`,
  // App-authored: an empty file, and requests the server refused or never received.
  emptyDropHint: "The file is empty",
  emptyBody: (fileName: string) => `${fileName} is empty — there is no audio in it to separate.`,
  uploadFailedTitle: "Upload failed",
  linkFailedTitle: "Couldn't fetch that link",
} as const;

export const processingCopy = {
  stages: ["Queued", "Downloading audio", "Separating stems", "Detecting tempo", "Detecting chords and key"],
  cancel: "Cancel",
  model: "Six-source model",
  estimate: (secondsLeft: number) => `Six-source model · ${remaining(secondsLeft)}`,
  loadingStems: "Loading stems…",
  decoding: "Decoding six stems in your browser",
  // App-authored
  cancelling: "Cancelling…",
} as const;

export const resultsCopy = {
  stemCount: (count: number) => `${count} stem${count === 1 ? "" : "s"}`,
  tabsLabel: "Result view",
  tabs: { mixer: "Mixer", console: "Console", analog: "Analog" },
  exportStems: "Export stems",
  newTrack: "New track",
  key: "Key",
  confident: (percent: number) => `${percent}% confident`,
  transpose: "Transpose",
  transposeDownSymbol: "−",
  transposeUpSymbol: "+",
  transposeDown: "Transpose down one semitone",
  transposeUp: "Transpose up one semitone",
  transposeHint: "semitones · chords follow",
  tempo: "Tempo",
  bpm: "BPM",
  masterLevel: "Master level",
  chords: "Chords",
  lyric: "Lyric",
  lyrics: "Lyrics",
  lyricsPlain: "Found, not synced — no timing available.",
  openLyricSheet: "Open lyric sheet",
  lyricsNone: "None found for this track.",
  addLyrics: "Add lyrics manually",
  columns: { stem: "Stem", level: "Level", routing: "Routing", waveform: "Waveform" },
  mute: "MUTE",
  solo: "SOLO",
  instrumental: "No vocal content detected — the vocals stem is present but silent.",
  stripState: { soloed: "Soloed", muted: "Muted", silent: "Silent", held: "Held", playing: "Playing" },
  level: "Level",
  pan: "Pan",
  tone: "Tone",
  master: "Master",
  output: "Output",
  peak: "Peak",
  metronome: "Metronome",
  on: "On",
  off: "Off",
  outputLevel: "Output level",
  dials: {
    left: "Output · left",
    right: "Output · right",
    truePeak: "True peak · dBTP",
    loudness: "Loudness · LUFS",
    correlation: "Correlation",
  },
  levelLabel: (stem: string, value: string) => `${stem} level, ${value} decibels`,
  toneLabel: (stem: string) => `${stem} tone`,
  panLabel: (stem: string, pan: string) => `${stem} pan, ${pan}`,
  play: "Play",
  pause: "Pause",
  seek: "Seek",
  loopOff: "Loop off",
  metronomeOn: "Metronome on",
  metronomeOff: "Metronome off",
  click: "Click",
  // App-authored: loading and empty states, accessible names, and the labels the speed and loop chips
  // move through once pressed.
  lookingForLyrics: "Looking for lyrics…",
  noChords: "No chord analysis for this track.",
  noValue: "—",
  masterLevelLabel: (value: string) => `Master level, ${value}`,
  muteLabel: (stem: string) => `Mute ${stem}`,
  soloLabel: (stem: string) => `Solo ${stem}`,
  seekText: (time: string, total: string) => `${time} of ${total}`,
  speedLabel: (rate: string) => `Playback speed, ${rate}`,
  speedUnavailable: "Speed control needs HTTPS or localhost",
  speedGroup: "Speed",
  loopA: (time: string) => `Loop A ${time}`,
  loopRange: (start: string, end: string) => `Loop ${start}–${end}`,
  metronomeClick: "Metronome click",
  noTempo: "No tempo was detected for this track",
} as const;

/** The four failure panels, keyed by the template's scenario ids. */
export const failureCopy = {
  "job-error": {
    title: "Separation failed",
    primary: "Try another source",
    secondary: "Copy log",
    // App-authored
    bodyFallback: "The job stopped with an error.",
    copied: "Copied",
  },
  "job-cancelled": {
    title: "Cancelled",
    // Reworded by decision: the template's second sentence promised a 24-hour queue the app doesn't keep.
    body: "You stopped this job before separation finished. The upload is kept until you leave this page if you want to resume it.",
    primary: "Resume job",
    secondary: "Discard",
    // App-authored
    resuming: "Resuming…",
    resumeFailed: "Failed to resume job",
  },
  "connection-error": {
    title: "Connection lost",
    body: (attempt: number, max: number) =>
      `Separation is still running on our side. Reconnecting automatically — retry ${attempt} of ${max}.`,
    primary: "Reconnect now",
    // Reworded by decision: the template's "Work offline" names a mode the app doesn't have.
    secondary: "New track",
    // App-authored: retries used up, and a job that no longer exists.
    gaveUp: (max: number) => `Separation is still running on our side. Reconnecting stopped after ${max} retries.`,
    notFoundTitle: "Job not found",
    notFoundBody: "This job no longer exists on the server — it may have been discarded from another tab.",
  },
  "results-load-error": {
    title: "Stems failed to load",
    body: (count: number) =>
      `Separation finished but ${countWord(count)} stem file${count === 1 ? "" : "s"} could not be fetched. Chords, key and tempo are still available.`,
    log: (url: string, message: string) => `GET ${url} — ${message}`,
    primary: "Retry download",
    secondary: "Open anyway",
    // App-authored
    retrying: "Retrying…",
  },
} as const;

/** App-authored: the dialogs the template's Export stems, Open lyric sheet and Add lyrics manually buttons open. */
export const dialogCopy = {
  export: {
    title: "Export stems",
    hint: "Uncompressed WAV, exactly as separated.",
    format: "WAV",
    download: "Download",
    downloadLabel: (stem: string) => `Download ${stem}`,
    saving: "Saving…",
    downloadAll: "Download all (.zip)",
    preparingZip: "Preparing zip…",
    close: "Close",
    failed: "That download didn't start — the server may be unreachable.",
  },
  lyricSheet: {
    title: "Lyric sheet",
    close: "Close",
  },
  addLyrics: {
    title: "Add lyrics",
    label: "Lyrics",
    hint: "Paste plain lyrics, or LRC lines such as [01:24.50] to sync them to the track.",
    cancel: "Cancel",
    save: "Save lyrics",
    saving: "Saving…",
    failedTitle: "Lyrics weren't saved",
    failedFallback: "Failed to save lyrics",
  },
} as const;

/** App-authored: the page footer, kept by decision though the template has none. */
export const footerCopy = {
  github: "GitHub",
  reportBug: "Report a bug",
  kofi: "Support on Ko-fi",
  copyright: (year: number, version: string) => `© ${year} Ormin Cariaso · v${version}`,
} as const;
