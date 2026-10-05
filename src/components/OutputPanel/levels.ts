/** Formatting helpers for level readouts. Never produces "NaN". */

const MINUS = '−';

/** 1-decimal dB text with a real minus sign; -Infinity → "−∞", non-finite/NaN → "—". */
export function formatDb(value: number | null | undefined, options: { signed?: boolean; unit?: string } = {}): string {
  const unit = options.unit ?? 'dB';
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === Number.NEGATIVE_INFINITY) return `${MINUS}∞ ${unit}`;
  if (value === Number.POSITIVE_INFINITY) return `+∞ ${unit}`;
  const rounded = Math.round(value * 10) / 10;
  // Avoid "-0.0".
  const text = Math.abs(rounded).toFixed(1);
  const sign = rounded < 0 ? MINUS : options.signed && rounded > 0 ? '+' : '';
  return `${sign}${text} ${unit}`;
}

export function formatLufs(value: number | null | undefined): string {
  return formatDb(value, { unit: 'LUFS' });
}

/** Maps a value in [min, max] to a 0–1 slider position. */
export function toPosition(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Inverse of toPosition, rounded to `step` and clamped. */
export function fromPosition(position: number, min: number, max: number, step: number): number {
  const raw = min + Math.min(1, Math.max(0, position)) * (max - min);
  const stepped = min + Math.round((raw - min) / step) * step;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
}

/** Resolution of the shared Slider's native range input (positions are multiples of 1/1000). */
const SLIDER_UNIT = 1 / 1000;

/**
 * Next value for a slider move. A keyboard arrow press moves the shared slider by one resolution unit (0.001),
 * which would round back to the current stepped value and look stuck; treat that as "one step in that direction".
 * Pointer drags and PageUp/PageDown/Home/End move by far more than one unit and map normally.
 */
export function nextValue(position: number, current: number, min: number, max: number, step: number): number {
  const shown = Math.round(toPosition(current, min, max) / SLIDER_UNIT) * SLIDER_UNIT; // what the range input currently holds
  const delta = position - shown;
  const mapped = fromPosition(position, min, max, step);
  if (mapped === current && Math.abs(Math.abs(delta) - SLIDER_UNIT) < SLIDER_UNIT / 4) {
    return fromPosition(toPosition(current + Math.sign(delta) * step, min, max), min, max, step);
  }
  return mapped;
}
