import type { ReactNode } from "react";
import { CABINET_BEZEL_PADDING, CABINET_GAP, CABINET_INTERIOR_COLOR, CABINET_INTERIOR_IMAGE, CABINET_POST_WIDTH, CABINET_WIDTH } from "./constants";

const WALNUT = "linear-gradient(90deg, #2e1a10 0%, #221208 12%, #3a2214 28%, #221208 44%, #2e1a10 60%, #3a2214 76%, #221208 90%, #2e1a10 100%)";
const BRASS = "linear-gradient(90deg, #6b5230, #b8935a 15%, #6b5230 30%, #b8935a 45%, #6b5230 60%, #b8935a 75%, #6b5230 90%, #b8935a 100%)";
const LEATHER = "linear-gradient(90deg,#1a1310,#241914,#1a1310)";
const RIVET = "linear-gradient(135deg,#b8935a,#6b5230)";

function BrassRivet() {
  return <div className="h-3.5 w-3.5 rounded-sm" style={{ background: RIVET, boxShadow: "0 1px 2px rgba(0,0,0,0.5)" }} />;
}

/** A walnut-and-brass studio rack cabinet that the whole Studio view sits inside. */
export function StudioCabinet({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto rounded-[10px]" style={{ width: CABINET_WIDTH, background: WALNUT, padding: "26px 22px", boxShadow: "0 30px 70px rgba(0,0,0,0.75), inset 0 2px 4px rgba(255,255,255,0.05)" }}>
      {/* top brass rail with branding plate */}
      <div
        className="relative flex items-center justify-center rounded-[3px]"
        style={{ height: 18, background: BRASS, marginBottom: CABINET_GAP, boxShadow: "inset 0 1px 2px rgba(255,255,255,0.3), inset 0 -1px 2px rgba(0,0,0,0.5)" }}
      >
        <div className="absolute left-3.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" style={{ backgroundColor: "#2a1c0e", boxShadow: "inset 0 1px 1px rgba(0,0,0,0.6)" }} />
        <span className="font-['Oswald'] text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: "#2a1c0e" }}>
          CHORD Rig Cabinet
        </span>
        <div className="absolute right-3.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" style={{ backgroundColor: "#2a1c0e", boxShadow: "inset 0 1px 1px rgba(0,0,0,0.6)" }} />
      </div>

      <div className="flex" style={{ gap: CABINET_GAP }}>
        <div
          className="flex flex-col items-center justify-between rounded-[5px] py-5"
          style={{ width: CABINET_POST_WIDTH, background: LEATHER, boxShadow: "inset 0 2px 4px rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.5)" }}
        >
          <BrassRivet />
          <BrassRivet />
        </div>

        <div
          className="min-w-0 flex-1 rounded-md"
          style={{
            backgroundColor: CABINET_INTERIOR_COLOR,
            backgroundImage: CABINET_INTERIOR_IMAGE,
            padding: CABINET_BEZEL_PADDING,
            boxShadow: "inset 0 3px 10px rgba(0,0,0,0.6)",
          }}
        >
          {children}
        </div>

        <div
          className="flex flex-col items-center justify-between rounded-[5px] py-5"
          style={{ width: CABINET_POST_WIDTH, background: LEATHER, boxShadow: "inset 0 2px 4px rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.5)" }}
        >
          <BrassRivet />
          <BrassRivet />
        </div>
      </div>

      {/* bottom brass rail */}
      <div
        className="relative rounded-[3px]"
        style={{ height: 18, background: BRASS, marginTop: CABINET_GAP, boxShadow: "inset 0 1px 2px rgba(255,255,255,0.3), inset 0 -1px 2px rgba(0,0,0,0.5)" }}
      >
        <div className="absolute left-3.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" style={{ backgroundColor: "#2a1c0e", boxShadow: "inset 0 1px 1px rgba(0,0,0,0.6)" }} />
        <div className="absolute right-3.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full" style={{ backgroundColor: "#2a1c0e", boxShadow: "inset 0 1px 1px rgba(0,0,0,0.6)" }} />
      </div>
    </div>
  );
}
