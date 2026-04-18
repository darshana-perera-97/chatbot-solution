import { getLeadQualityParts } from "../leadQuality";

/** Table cell: lead completeness vs configured fields-to-collect (percentage only). */
export function LeadQualityCell({ row }) {
  const q = getLeadQualityParts(row);
  if (q.total <= 0) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <span className="font-semibold tabular-nums text-slate-800">{q.percent}%</span>
  );
}
