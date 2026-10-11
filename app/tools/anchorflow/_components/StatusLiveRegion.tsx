"use client";

import React from "react";
import { useToolStore } from "../_store/useToolStore";

/**
 * Sole screen-reader status channel for async pipeline transitions.
 *
 * The wrapper stays permanently mounted so assistive tech keeps the live
 * region registered; each announcement is keyed by its monotonic `seq`
 * (see StatusAnnouncement) so identical messages re-announce.
 */
export function StatusLiveRegion() {
  const announcement = useToolStore((s) => s.statusAnnouncement);

  return (
    <div className="sr-only">
      {announcement ? (
        <div key={announcement.seq} role="status" aria-live="polite">
          {announcement.message}
        </div>
      ) : null}
    </div>
  );
}
