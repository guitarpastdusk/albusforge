import type { SampleReadings } from "@/lib/example-readings";

/**
 * The sample readings an example build's device would send: a column per
 * channel a part in the build reads or drives, a row per sample, newest last.
 * Times are UTC so the table reads the same everywhere.
 */
export function SampleReadingsTable({ readings }: { readings: SampleReadings }) {
  const { columns, rows, cadence } = readings;
  return (
    <div className="mt-4 overflow-x-auto rounded-[20px] border border-hairline bg-white">
      <table className="w-full border-collapse text-left">
        <caption className="caption-bottom px-6 pt-3 pb-5 text-left text-[14px] font-light leading-[1.45] text-muted">
          Sample data, one row every {cadence}, in the shape {columns.length === 1 ? "the channel" : "these channels"} would arrive in — not a reading from a
          built device.
        </caption>
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className="px-6 py-3.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
              Time (UTC)
            </th>
            {columns.map((column) => (
              <th key={column.label} scope="col" className="px-6 py-3.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
                {column.label}
                {column.unit ? <span className="font-mono normal-case tracking-normal text-faint"> {column.unit}</span> : null}
                <span className="block font-mono text-[11px] font-normal normal-case tracking-normal text-faint">{column.part.id}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.at} className="border-b border-hairline last:border-0">
              <td className="px-6 py-3 font-mono text-[13px] whitespace-nowrap text-muted">
                <time dateTime={row.at}>{row.when}</time>
              </td>
              {row.cells.map((cell, index) => (
                <td key={columns[index]!.label} className="px-6 py-3 font-mono text-[14px] whitespace-nowrap text-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
