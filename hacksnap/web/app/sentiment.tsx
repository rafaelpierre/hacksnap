"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import { skepticismDisplay } from "../lib/sentiment";

export function Sentiment({value, noComments = false}: {value: -1 | 0 | 1 | null; noComments?: boolean}) {
  const { label, position } = skepticismDisplay(value, noComments);
  const [tooltip, setTooltip] = useState<"info" | "value" | null>(null);
  const id = useId();
  const description = position === null
    ? (noComments ? "No usable comments available to estimate skepticism." : "Skepticism will appear after the summary refreshes.")
    : `${label} skepticism. Estimated from sampled thread comments.`;
  const info = "Measures the level of skepticism in sampled comments. Further right means more skeptical.";
  return <figure className={`sentiment skepticism-${position === null ? "pending" : label.toLowerCase()}`}
    onKeyDown={event => { if (event.key === "Escape") setTooltip(null); }}>
    <figcaption>Skept-o-meter
      <button type="button" className="skepticism-info" aria-label="About the Skept-o-meter"
        aria-describedby={tooltip === "info" ? `${id}-info` : undefined}
        onMouseEnter={() => setTooltip("info")} onMouseLeave={() => setTooltip(null)}
        onFocus={() => setTooltip("info")} onBlur={() => setTooltip(null)} onClick={() => setTooltip("info")}>
        <Info size={12} strokeWidth={1.5} aria-hidden="true" />
        <span id={`${id}-info`} role="tooltip" className="skepticism-tooltip" hidden={tooltip !== "info"}>{info}</span>
      </button>
    </figcaption>
    <button type="button" className="skepticism-scale" aria-label={`Skept-o-meter: ${label}`}
      aria-describedby={tooltip === "value" ? `${id}-value` : undefined}
      onMouseEnter={() => setTooltip("value")} onMouseLeave={() => setTooltip(null)}
      onFocus={() => setTooltip("value")} onBlur={() => setTooltip(null)} onClick={() => setTooltip("value")}>
      <span className="skepticism-rail" aria-hidden="true">
        {position !== null && <span className="skepticism-marker" style={{left: `${position}%`}} />}
      </span>
      <span id={`${id}-value`} role="tooltip" className="skepticism-tooltip" hidden={tooltip !== "value"}>{description}</span>
    </button>
  </figure>;
}
