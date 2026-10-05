import type { ParamSpec } from '../effects/BaseEffect';
import { clamp } from './math';

/** Maps a parameter value to a 0–1 slider position, honouring log scale for frequency-like parameters. */
export function valueToPosition(spec: ParamSpec, value: number): number {
  const v = clamp(value, spec.min, spec.max);
  if (spec.max === spec.min) return 0;
  if (spec.scale === 'log' && spec.min > 0) {
    return Math.log(v / spec.min) / Math.log(spec.max / spec.min);
  }
  return (v - spec.min) / (spec.max - spec.min);
}

/** Inverse of valueToPosition, rounded to the parameter's step and clamped to its range. */
export function positionToValue(spec: ParamSpec, position: number): number {
  const p = clamp(position, 0, 1);
  const raw =
    spec.scale === 'log' && spec.min > 0 ? spec.min * Math.pow(spec.max / spec.min, p) : spec.min + p * (spec.max - spec.min);
  const stepped = spec.step > 0 ? spec.min + Math.round((raw - spec.min) / spec.step) * spec.step : raw;
  // Strip float noise such as 0.30000000000000004 introduced by repeated step arithmetic.
  return clamp(Number(stepped.toFixed(6)), spec.min, spec.max);
}

export function formatParamValue(spec: ParamSpec, value: number): string {
  const option = spec.options?.find((candidate) => candidate.value === value);
  if (option) return option.label;
  if (spec.percent) return `${Math.round(value * 100)}%`;
  if (spec.unit === 'Hz' && value >= 1000) {
    // 7500 → "7.5 kHz", 3200 → "3.2 kHz", 12000 → "12 kHz"
    return `${Number((value / 1000).toFixed(2))} kHz`;
  }
  const decimals = spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : 2;
  const text = value.toFixed(decimals);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

/**
 * One keyboard step from `value`. The slider track has 1000 positions, so a native arrow press (1/1000 of the range)
 * rounds back to the same value for any parameter with fewer than 1000 steps. Stepping in parameter units instead
 * guarantees every press visibly changes the value. Log-scaled parameters step by about 1 % of their log range.
 */
export function stepValue(spec: ParamSpec, value: number, direction: 1 | -1, large = false): number {
  const factor = large ? 10 : 1;
  if (spec.scale === 'log' && spec.min > 0) {
    const target = positionToValue(spec, valueToPosition(spec, value) + direction * 0.01 * factor);
    if (target !== value) return target;
  }
  return clamp(Number((value + direction * spec.step * factor).toFixed(6)), spec.min, spec.max);
}
