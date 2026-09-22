import { Clock } from "lucide-react";

export function SummaryPending() {
  return <span className="summary-pending" tabIndex={0} aria-label="Summary hasn’t been generated yet.">
    <Clock size={15} aria-hidden="true" />
    <span className="summary-pending-tooltip" aria-hidden="true">Summary hasn’t been generated yet.</span>
  </span>;
}
