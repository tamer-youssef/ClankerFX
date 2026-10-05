import type { BatchProgress } from "../../audio/batchRunner";
import type { LoadedFile } from "../../types/audio";
import { formatTime } from "../../utils/format";
import { formatLufs } from "../OutputPanel/levels";
import { isClipped, plainDb, plural, type BatchRun } from "./batchUtils";

interface BatchTableProps {
  files: readonly LoadedFile[];
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  run: BatchRun | null;
  progress: BatchProgress | null;
  stale: boolean;
  running: boolean;
  onToggle: (id: string) => void;
  onPreview: (id: string) => void;
}

/** Status text + result numbers for one file, derived from the latest run (if any). */
function describeRow(
  file: LoadedFile,
  selected: boolean,
  run: BatchRun | null,
  progress: BatchProgress | null,
) {
  const mine = run
    ? run.jobs
        .map((job, index) => ({ job, index }))
        .filter(({ job }) => job.fileId === file.id)
    : [];
  if (!run || mine.length === 0)
    return {
      state: selected ? "idle" : "skipped",
      results: [],
      failures: [] as string[],
    } as const;

  const byId = new Map(run.results.map((result) => [result.jobId, result]));
  const results = mine.flatMap(({ job }) => byId.get(job.id) ?? []);
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => result.error ?? "Processing failed");
  if (run.phase === "running") {
    const completed = progress?.completed ?? 0;
    const state = mine.every(({ index }) => index < completed)
      ? "done"
      : mine.some(({ index }) => index === completed)
        ? "rendering"
        : "queued";
    return { state, results, failures } as const;
  }
  if (results.length < mine.length)
    return { state: "notRun", results, failures } as const;
  return {
    state: failures.length === results.length ? "failed" : "done",
    results,
    failures,
  } as const;
}

const STATUS_TEXT = {
  idle: "Ready",
  skipped: "Not selected",
  queued: "Queued",
  rendering: "Rendering…",
  done: "Done",
  failed: "Failed",
  notRun: "Not processed",
} as const;

export function BatchTable({
  files,
  selectedIds,
  activeId,
  run,
  progress,
  stale,
  running,
  onToggle,
  onPreview,
}: BatchTableProps) {
  return (
    <div className="batch__table-wrap">
      <table
        className="batch-table"
        role="table"
        aria-label="Files in this batch"
      >
        <thead role="rowgroup">
          <tr role="row">
            <th role="columnheader" scope="col" className="batch-table__check">
              <span className="sr-only">Include</span>
            </th>
            <th role="columnheader" scope="col">
              File
            </th>
            <th role="columnheader" scope="col">
              Length
            </th>
            <th role="columnheader" scope="col">
              Status
            </th>
            <th role="columnheader" scope="col">
              Final loudness (LUFS)
            </th>
            <th role="columnheader" scope="col">
              Gain (dB)
            </th>
            <th role="columnheader" scope="col">
              Final peak (dBFS)
            </th>
            <th role="columnheader" scope="col">
              Clipping
            </th>
            <th role="columnheader" scope="col">
              <span className="sr-only">Preview</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {files.map((file) => {
            const selected = selectedIds.has(file.id);
            const active = file.id === activeId;
            const { state, results, failures } = describeRow(
              file,
              selected,
              run,
              progress,
            );
            const first = results.find(
              (result) => result.ok && result.measurements,
            );
            const m = first?.measurements;
            const okCount = results.filter((result) => result.ok).length;
            const clipped = first ? isClipped(first) : false;
            const dim = stale && first !== undefined;
            const statusKey = state === "skipped" ? "skipped" : state;
            return (
              <tr
                key={file.id}
                role="row"
                aria-current={active ? "true" : undefined}
                className={`batch-row${active ? " batch-row--active" : ""}${selected ? "" : " batch-row--off"}${dim ? " batch-row--stale" : ""}`}
              >
                <td role="cell" className="batch-table__check">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={running}
                    aria-label={`Include ${file.name}`}
                    onChange={() => onToggle(file.id)}
                  />
                </td>
                <td role="cell" className="batch-table__name" data-label="File">
                  <span className="batch-name" title={file.name}>
                    {file.name}
                  </span>
                </td>
                <td
                  role="cell"
                  className="batch-table__num"
                  data-label="Length"
                >
                  {formatTime(file.buffer.duration)}
                </td>
                <td
                  role="cell"
                  className={`batch-table__status batch-status--${statusKey}`}
                  data-label="Status"
                >
                  <span className="batch-status-body">
                    <span>{STATUS_TEXT[statusKey]}</span>
                    {dim && <span className="batch-outdated"> (outdated)</span>}
                    {failures.length > 0 && (
                      <span className="batch-error">
                        {failures[0]}
                        {failures.length > 1
                          ? ` (+${failures.length - 1} more)`
                          : ""}
                      </span>
                    )}
                    {m?.warning && (
                      <span className="batch-note">{m.warning}</span>
                    )}
                    {okCount > 1 && (
                      <span
                        className="batch-more"
                        title={results
                          .map(
                            (r) =>
                              `${r.outputName}: ${r.measurements ? formatLufs(r.measurements.finalLoudnessLufs) : "failed"}`,
                          )
                          .join("\n")}
                      >
                        {" "}
                        First of {plural(okCount, "variation")}
                      </span>
                    )}
                  </span>
                </td>
                <td
                  role="cell"
                  className="batch-table__num"
                  data-label="Final loudness (LUFS)"
                >
                  {m ? plainDb(m.finalLoudnessLufs) : "—"}
                </td>
                <td
                  role="cell"
                  className="batch-table__num"
                  data-label="Gain (dB)"
                >
                  {m ? plainDb(m.gainDb, true) : "—"}
                </td>
                <td
                  role="cell"
                  className="batch-table__num"
                  data-label="Final peak (dBFS)"
                >
                  {m ? plainDb(m.finalPeakDb) : "—"}
                </td>
                <td
                  role="cell"
                  className="batch-table__clip"
                  data-label="Clipping"
                >
                  {first ? (
                    <span
                      className={`batch-clip ${clipped ? "batch-clip--bad" : "batch-clip--ok"}`}
                    >
                      <span aria-hidden="true">{clipped ? "▲ " : "● "}</span>
                      {clipped ? "CLIP" : "OK"}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td role="cell" className="batch-table__act">
                  <button
                    type="button"
                    className="btn batch-preview"
                    aria-label={`Preview ${file.name}`}
                    aria-pressed={active}
                    onClick={() => onPreview(file.id)}
                  >
                    {active ? "Previewing" : "Preview"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
