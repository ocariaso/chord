export type JobStatus = "queued" | "fetching" | "separating" | "analyzing" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  original_filename: string;
  author: string | null;
  status: JobStatus;
  progress: number;
  stage_message: string | null;
  error_message: string | null;
  error_log: string | null;
  stems_model: string | null;
  duration_seconds: number | null;
  audio_format: string | null;
  key_estimate: string | null;
  key_confidence: number | null;
  tempo_bpm: number | null;
  created_at: string;
  updated_at: string;
  stem_names: string[];
  has_thumbnail: boolean;
}

export interface ChordSegment {
  start: number;
  end: number;
  chord: string;
  confidence: number;
}

export interface LyricsLine {
  time: number;
  text: string;
}

export interface Lyrics {
  synced: LyricsLine[] | null;
  plain: string | null;
}

/** A non-2xx response. `message` is the server's own `detail` text when it sent one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const API_BASE = "/api";

function detailOf(body: unknown): string | null {
  // FastAPI's validation errors carry a list here rather than a sentence.
  const detail = (body as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" ? detail : null;
}

async function errorFrom(res: Response, fallback: string): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  return new ApiError(detailOf(body) ?? `${fallback} (${res.status})`, res.status);
}

/** A POST whose one failure without a response — the server unreachable — becomes a sentence for the user. */
async function post(url: string, init: RequestInit, unreachable: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, method: "POST" });
  } catch {
    // fetch rejects only when no response arrived at all.
    throw new ApiError(unreachable, 0);
  }
}

export async function createJob(file: File): Promise<Job> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await post(`${API_BASE}/jobs`, { body: formData }, "Upload failed — the server couldn't be reached.");
  if (res.status === 413) {
    // nginx answers this one itself, with an HTML page rather than a JSON detail.
    throw new ApiError("That file is larger than the server accepts.", 413);
  }
  if (!res.ok) throw await errorFrom(res, "Upload failed");
  return res.json();
}

export async function createJobFromUrl(url: string): Promise<Job> {
  const res = await post(
    `${API_BASE}/jobs/from-url`,
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) },
    "Couldn't start the download — the server couldn't be reached.",
  );
  if (!res.ok) throw await errorFrom(res, "Failed to start download");
  return res.json();
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new ApiError(`Failed to fetch job (${res.status})`, res.status);
  return res.json();
}

export function jobEventsUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/events`;
}

export function cancelJobUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/cancel`;
}

export function discardJobUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/discard`;
}

export async function cancelJob(jobId: string): Promise<Job> {
  const res = await fetch(cancelJobUrl(jobId), { method: "POST" });
  if (!res.ok) throw await errorFrom(res, "Failed to cancel job");
  return res.json();
}

export async function resumeJob(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/resume`, { method: "POST" });
  if (!res.ok) throw await errorFrom(res, "Failed to resume job");
  return res.json();
}

export function stemUrl(jobId: string, stemName: string): string {
  return `${API_BASE}/jobs/${jobId}/stems/${stemName}.wav`;
}

export function thumbnailUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/thumbnail.jpg`;
}

export function downloadAllUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/download`;
}

export async function getChords(jobId: string): Promise<ChordSegment[]> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/chords`);
  if (!res.ok) throw new ApiError(`Failed to fetch chords (${res.status})`, res.status);
  return res.json();
}

/** Returns null if no lyrics were found for this job. */
export async function getLyrics(jobId: string): Promise<Lyrics | null> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/lyrics`);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`Failed to fetch lyrics (${res.status})`, res.status);
  return res.json();
}

/** Replaces the job's lyrics with pasted text; LRC timestamps in it make the result synced. */
export async function saveLyrics(jobId: string, text: string): Promise<Lyrics> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/lyrics`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw await errorFrom(res, "Failed to save lyrics");
  return res.json();
}
