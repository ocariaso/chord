// Decoding resamples stems to the output device's rate and can leave them a frame short — a
// 36-second track decodes to 35.99998 s at 44.1 kHz — which would otherwise read as 0:35.
const WHOLE_SECOND_SLACK = 0.005;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds + WHOLE_SECOND_SLACK);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
