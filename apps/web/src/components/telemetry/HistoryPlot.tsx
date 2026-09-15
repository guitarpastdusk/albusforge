import type { TelemetryHistory } from "@albusforge/schema";
import type { z } from "zod";

type History = z.infer<typeof TelemetryHistory>;
/**
 * Dots deliberately do not connect absent samples or imply interpolation.
 *
 * `color` is the channel's series colour (lib/series-color.ts). Each plot is a
 * single series named by its own heading, so the colour is redundant encoding
 * rather than the thing carrying identity — which is why a repeat past five
 * channels is harmless here.
 */
export function HistoryPlot({
  history,
  unit,
  color = "var(--color-series-1)",
}: {
  history: History;
  unit: string;
  color?: string;
}) {
  const { points } = history;
  if (!points.length)
    return (
      <p className="py-8 text-muted">
        No stored samples in this window
        {history.pending_rollup ? "; rollups are still pending" : ""}.
      </p>
    );
  const minimum = Math.min(...points.map((p) => p.v)),
    maximum = Math.max(...points.map((p) => p.v));
  const spread = maximum - minimum || 1;
  const start = Date.parse(history.from),
    duration = Date.parse(history.to) - start;
  return (
    <>
      <svg
        viewBox="0 0 800 260"
        role="img"
        aria-label={`${history.channel}: ${history.resolution === "raw" ? "raw samples" : "bucket averages"}, ${unit}. Dots use actual UTC timestamps; gaps are not interpolated.`}
        className="w-full mt-6"
      >
        <text x="4" y="16" fontSize="12" fill="var(--color-muted)">
          {maximum} {unit}
        </text>
        <text x="4" y="230" fontSize="12" fill="var(--color-muted)">
          {minimum} {unit}
        </text>
        <path d="M80 20V220H790" fill="none" stroke="var(--color-hairline)" strokeWidth="1.5" />
        {points.map((p, i) => (
          <g key={i}>
            {/* The hit target is larger than the mark, so a dot is easy to hover. */}
            <circle
              cx={80 + ((Date.parse(p.t) - start) / duration) * 710}
              cy={220 - ((p.v - minimum) / spread) * 190}
              r="10"
              fill="transparent"
            >
              <title>{`${p.t}: ${p.v} ${unit}${
                "n" in p
                  ? `; ${p.n} samples, min ${p.min}, max ${p.max}`
                  : `; sequence ${p.seq}, ordinal ${p.ordinal}`
              }`}</title>
            </circle>
            <circle
              cx={80 + ((Date.parse(p.t) - start) / duration) * 710}
              cy={220 - ((p.v - minimum) / spread) * 190}
              r="4"
              fill={color}
              stroke="var(--color-porcelain)"
              strokeWidth="1.5"
              pointerEvents="none"
            />
          </g>
        ))}
        <text x="80" y="250" fontSize="10" fill="var(--color-faint)">
          {history.from}
        </text>
        <text x="790" y="250" textAnchor="end" fontSize="10" fill="var(--color-faint)">
          {history.to}
        </text>
      </svg>
      <details className="mt-4">
        <summary className="cursor-pointer">
          Inspect {points.length}{" "}
          {history.resolution === "raw" ? "samples" : "averages"}
        </summary>
        <div className="overflow-auto max-h-96">
          <table className="w-full text-left text-sm">
            <caption className="text-left py-3">
              UTC timestamps; {unit}. Raw identity or aggregate sample count is
              preserved.
            </caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>{history.resolution === "raw" ? "Value" : "Mean"}</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i} className="border-b border-current/10">
                  <td className="py-2 whitespace-nowrap">{p.t}</td>
                  <td>{p.v}</td>
                  <td>
                    {"seq" in p
                      ? `seq ${p.seq} · ordinal ${p.ordinal}`
                      : `n ${p.n} · min ${p.min} · max ${p.max} · last ${p.last}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
