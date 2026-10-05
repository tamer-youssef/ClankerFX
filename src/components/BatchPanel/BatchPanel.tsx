import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { downloadBatch, runBatch, summarizeBatch, type BatchPackaging, type BatchProgress } from '../../audio/batchRunner';
import { defaultBatchOptions, planBatch, type BatchOptions } from '../../batch/plan';
import { builtInPresets } from '../../presets/builtInPresets';
import { chainMatchesPreset } from '../../presets/presetLibrary';
import { useApp } from '../../state/AppContext';
import { getSelectedFiles } from '../../state/appState';
import { formatBytes } from '../../utils/format';
import { formatLufs } from '../OutputPanel/levels';
import { BatchOptionsForm, type FormValues } from './BatchOptionsForm';
import { BatchTable } from './BatchTable';
import { effectiveSuffix, exportKey, optionsKey, plural, type BatchRun, type RunSnapshot } from './batchUtils';
import './BatchPanel.css';

const NAME_PREVIEW_COUNT = 5;

/** The batch section only exists when there is something to batch; single-file work stays uncluttered. */
export function BatchPanel() {
  const { state } = useApp();
  if (state.files.length < 2) return null;
  return <BatchSection />;
}

function BatchSection() {
  const { state, dispatch } = useApp();
  const { files, chain, normalization, exportSettings } = state;
  const titleId = useId();

  const [options, setOptions] = useState<Omit<BatchOptions, 'suffix'>>({
    mode: defaultBatchOptions.mode,
    variationCount: defaultBatchOptions.variationCount,
    intensity: defaultBatchOptions.intensity,
    seed: defaultBatchOptions.seed,
  });
  const [suffixText, setSuffixText] = useState(exportSettings.filenameSuffix);
  const [packaging, setPackaging] = useState<BatchPackaging>('zip');
  const [showAllNames, setShowAllNames] = useState(false);
  const [run, setRun] = useState<BatchRun | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One source of truth for the suffix: follow edits made elsewhere (the Export dialog).
  useEffect(() => setSuffixText(exportSettings.filenameSuffix), [exportSettings.filenameSuffix]);

  const cancelRef = useRef(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // The panel goes away (e.g. files were removed): stop before the next file and drop the results.
      aliveRef.current = false;
      cancelRef.current = true;
    };
  }, []);

  const selected = useMemo(() => getSelectedFiles(state), [state.files, state.selectedFileIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedIds = useMemo(() => new Set(selected.map((file) => file.id)), [selected]);
  const batchOptions: BatchOptions = { ...options, suffix: effectiveSuffix(suffixText) };
  const jobs = useMemo(
    () => planBatch(selected.map((file) => ({ id: file.id, name: file.name })), batchOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, options, suffixText],
  );

  const phase = run?.phase ?? null;
  const running = phase === 'running' || phase === 'packaging';
  const currentKey = optionsKey(batchOptions);
  const stale =
    run !== null &&
    (run.snapshot.chain !== chain ||
      run.snapshot.normalization !== normalization ||
      run.snapshot.exportKey !== exportKey(exportSettings) ||
      run.snapshot.optionsKey !== currentKey);

  const presetName = useMemo(() => {
    const preset = [...builtInPresets, ...state.userPresets].find((candidate) => candidate.id === state.selectedPresetId);
    return preset && chainMatchesPreset(chain, preset) ? preset.name : 'custom chain';
  }, [chain, state.selectedPresetId, state.userPresets]);

  const commitSuffix = (suffix: string) => {
    if (suffix !== exportSettings.filenameSuffix) dispatch({ type: 'output/setExport', changes: { filenameSuffix: suffix } });
  };

  const start = async () => {
    if (busyRef.current || jobs.length === 0) return;
    busyRef.current = true;
    cancelRef.current = false;
    setError(null);

    const suffix = effectiveSuffix(suffixText);
    setSuffixText(suffix);
    commitSuffix(suffix);
    const snapshot: RunSnapshot = { chain, normalization, exportKey: exportKey(exportSettings), optionsKey: currentKey };
    const planned = jobs;
    const alive = () => aliveRef.current;
    setProgress({ completed: 0, total: planned.length, current: planned[0]?.outputName ?? null });
    setRun({ jobs: planned, results: [], phase: 'running', snapshot });

    try {
      const results = await runBatch({
        jobs: planned,
        files: new Map(files.map((file) => [file.id, file])),
        chain,
        normalization,
        settings: { ...exportSettings, filenameSuffix: suffix },
        intensity: options.intensity,
        onProgress: (next) => {
          if (alive()) setProgress(next);
        },
        isCancelled: () => cancelRef.current,
      });
      if (!alive()) return;
      const cancelled = cancelRef.current;
      setRun({ jobs: planned, results, phase: cancelled ? 'cancelled' : 'packaging', snapshot });
      if (!cancelled) {
        try {
          await downloadBatch(results, packaging);
        } catch (downloadError) {
          if (alive()) setError(downloadError instanceof Error ? downloadError.message : 'The files could not be downloaded');
        }
        if (alive()) setRun({ jobs: planned, results, phase: 'done', snapshot });
      }
    } catch (runError) {
      if (alive()) {
        setError(runError instanceof Error && runError.message ? runError.message : 'The batch could not be processed');
        setRun(null);
      }
    } finally {
      busyRef.current = false;
      if (alive()) setProgress(null);
    }
  };

  const downloadAgain = async () => {
    if (!run || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      await downloadBatch(run.results, packaging);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'The files could not be downloaded');
    } finally {
      busyRef.current = false;
    }
  };

  const form: FormValues = { ...options, suffix: suffixText, packaging };
  const loudnessMode = normalization.mode === 'loudness';
  const summary = run && (phase === 'done' || phase === 'cancelled') ? summarizeBatch(run.results) : null;
  const names = jobs.map((job) => job.outputName);
  const shownNames = showAllNames ? names : names.slice(0, NAME_PREVIEW_COUNT);
  const hiddenCount = names.length - shownNames.length;
  const canDownloadFinished = run !== null && !running && !stale && (summary?.succeeded ?? 0) > 0;
  const percent = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <section className="batch" aria-labelledby={titleId}>
      <div className="batch__head">
        <h2 id={titleId} className="panel-title">
          Batch · {plural(files.length, 'file')}
        </h2>
        <div className="batch__select">
          <button type="button" className="btn" disabled={running} onClick={() => dispatch({ type: 'batch/setSelection', ids: files.map((file) => file.id) })}>
            Select all
          </button>
          <button type="button" className="btn" disabled={running} onClick={() => dispatch({ type: 'batch/setSelection', ids: [] })}>
            None
          </button>
          <span className="batch__count" aria-live="polite">
            {selected.length} of {files.length} selected
          </span>
        </div>
      </div>

      <p className="batch__applies">
        Applies the current effect chain ({presetName}, {plural(chain.length, 'effect')}) to every selected file
      </p>
      {chain.length === 0 && (
        <p className="batch__warn">
          The effect chain is empty, so files will only be level-processed
          {options.mode === 'variations' ? ' and every variation will sound the same' : ''}.
        </p>
      )}

      <div className="batch__tip">
        {loudnessMode ? (
          <p>Matching all files to {formatLufs(normalization.loudnessTargetLufs)}. Change the target in the Output panel.</p>
        ) : (
          <>
            <p>Tip: Match loudness makes every file equally loud.</p>
            <button
              type="button"
              className="btn"
              disabled={running}
              onClick={() => dispatch({ type: 'output/setNormalization', changes: { mode: 'loudness' } })}
            >
              Match loudness {formatLufs(normalization.loudnessTargetLufs)}
            </button>
          </>
        )}
      </div>

      <BatchTable
        files={files}
        selectedIds={selectedIds}
        activeId={state.activeFileId}
        run={run}
        progress={progress}
        stale={stale}
        running={running}
        onToggle={(id) => dispatch({ type: 'batch/toggle', id })}
        onPreview={(id) => dispatch({ type: 'files/activated', id })}
      />

      <BatchOptionsForm
        values={form}
        disabled={running}
        onSuffixText={setSuffixText}
        onCommitSuffix={commitSuffix}
        onChange={({ packaging: nextPackaging, suffix: _suffix, ...rest }) => {
          if (nextPackaging) setPackaging(nextPackaging);
          if (Object.keys(rest).length > 0) setOptions((current) => ({ ...current, ...rest }));
        }}
      />

      <div className="batch__names">
        <p className="batch__names-title">
          {jobs.length === 0 ? 'No files selected' : `${plural(jobs.length, 'file')} will be created`}
        </p>
        {jobs.length > 0 && (
          <>
            <ul className="batch__name-list" aria-label="Output file names">
              {shownNames.map((name, index) => (
                <li key={`${name}-${index}`}>{name}</li>
              ))}
            </ul>
            {names.length > NAME_PREVIEW_COUNT && (
              <button type="button" className="batch__more" aria-expanded={showAllNames} onClick={() => setShowAllNames((value) => !value)}>
                {showAllNames ? 'Show fewer' : `+${hiddenCount} more`}
              </button>
            )}
          </>
        )}
      </div>

      <div className="batch__actions">
        <button type="button" className="btn btn--primary batch__go" disabled={jobs.length === 0 || running} onClick={() => void start()}>
          Process &amp; download ({plural(jobs.length, 'file')})
        </button>
        {running && phase === 'running' && (
          <button type="button" className="btn" onClick={() => (cancelRef.current = true)}>
            Cancel
          </button>
        )}
        {canDownloadFinished && (
          <button type="button" className="btn" onClick={() => void downloadAgain()}>
            {phase === 'cancelled' ? 'Download finished files' : 'Download again'}
          </button>
        )}
      </div>

      {running && progress && (
        <div className="batch__progress">
          {(() => {
            const label =
              phase === 'packaging' || progress.current === null
                ? 'Preparing download…'
                : `Rendering ${Math.min(progress.completed + 1, progress.total)} of ${progress.total} — ${progress.current}`;
            return (
              <>
                <div className="batch__bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}>
                  <div className="batch__bar-fill" style={{ width: `${percent}%` }} />
                </div>
                <p className="batch__progress-label">{label}</p>
              </>
            );
          })()}
        </div>
      )}
      {running && !progress && phase === 'packaging' && <p className="batch__progress-label">Preparing download…</p>}

      {summary && run && (
        <p className="batch__summary" role="status">
          {plural(summary.succeeded, 'file')} processed, {summary.failed} failed, {summary.clipped} clipped, {formatBytes(summary.totalBytes)}
          {phase === 'cancelled' ? ` — cancelled after ${run.results.length} of ${run.jobs.length}` : ''}
          {stale ? ' (outdated: settings changed since)' : ''}
        </p>
      )}
      {error && (
        <p className="batch__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
