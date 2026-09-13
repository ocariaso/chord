import type { Job } from "../../api/client";
import { CoverArt } from "../../components/CoverArt";
import { PlusIcon } from "../../components/icons";
import { MarqueeText } from "../../components/MarqueeText";
import { resultsCopy } from "../../design/copy";
import type { ResultView } from "../../design/player";
import { formatTime } from "../../utils/time";

const VIEWS: ResultView[] = ["mixer", "console", "analog"];

interface ResultsTopbarProps {
  job: Job;
  duration: number;
  stemCount: number;
  view: ResultView;
  /** The id of the element the tabs control; each tab's id is derived from it. */
  panelId: string;
  onViewChange: (view: ResultView) => void;
  onExport: () => void;
  onNewTrack: () => void;
}

/** `.ch-topbar`: cover, title and meta, the view tabs, Export stems and New track. A title too long for the bar scrolls. */
export function ResultsTopbar({ job, duration, stemCount, view, panelId, onViewChange, onExport, onNewTrack }: ResultsTopbarProps) {
  // The decoded length rather than the server's, so the subtitle can never disagree with the transport.
  const meta = [job.author, formatTime(duration), resultsCopy.stemCount(stemCount)].filter(Boolean).join(" · ");

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = VIEWS.indexOf(view);
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") next = (index + VIEWS.length - 1) % VIEWS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = VIEWS.length - 1;
    else return;
    event.preventDefault();
    onViewChange(VIEWS[next]);
    document.getElementById(`${panelId}-${VIEWS[next]}-tab`)?.focus();
  }

  return (
    // On the page ground, not a card: the bottom hairline alone sets the bar off.
    <div className="ch-topbar" style={{ background: "transparent" }}>
      <CoverArt jobId={job.id} hasThumbnail={job.has_thumbnail} size={44} radius={6} />
      <div className="ch-topbar-title">
        {/* An h1 for the document outline; letter-spacing undoes the heading rule so it reads like the title class alone. */}
        <MarqueeText as="h1" text={job.original_filename} className="ch-title" style={{ letterSpacing: "normal" }} />
        <span className="ch-subtitle">{meta}</span>
      </div>
      <div className="ch-tabs" role="tablist" aria-label={resultsCopy.tabsLabel} onKeyDown={handleTabKeyDown}>
        {VIEWS.map((option) => (
          <button
            key={option}
            id={`${panelId}-${option}-tab`}
            type="button"
            className="ch-tab"
            role="tab"
            aria-selected={view === option}
            aria-controls={panelId}
            tabIndex={view === option ? 0 : -1}
            onClick={() => onViewChange(option)}
          >
            {resultsCopy.tabs[option]}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-secondary" style={{ flex: "none", fontSize: 11.5 }} onClick={onExport}>
        {resultsCopy.exportStems}
      </button>
      <span className="ch-divider-x" style={{ height: 22, alignSelf: "center" }} />
      <button
        type="button"
        className="btn btn-ghost"
        style={{ flex: "none", fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}
        onClick={onNewTrack}
      >
        <PlusIcon />
        {resultsCopy.newTrack}
      </button>
    </div>
  );
}
