const SMOOTHING_TIME_CONSTANT = 0.015;

/**
 * Sets an AudioParam either instantly (offline render, initial setup) or with an exponential approach that
 * avoids zipper noise while a slider is being dragged.
 */
export function setParam(context: BaseAudioContext, param: AudioParam, value: number, immediate: boolean): void {
  if (!Number.isFinite(value)) return;
  if (immediate) {
    param.cancelScheduledValues(0);
    param.value = value;
  } else {
    param.setTargetAtTime(value, context.currentTime, SMOOTHING_TIME_CONSTANT);
  }
}

/**
 * Q for a non-resonant (Butterworth, Q = 1/√2) low-pass or high-pass BiquadFilterNode.
 *
 * Web Audio quirk: for `lowpass`/`highpass` the Q parameter is in **decibels**, not linear, and defaults to 1 dB —
 * a resonant peak of roughly +1.6 dB at the cutoff. Inside a feedback loop (e.g. delay damping) that peak pushes the
 * loop gain above 1 and the signal grows without bound, so always set this explicitly. (Peaking, shelf and
 * all-pass filters use linear Q.)
 */
export const NON_RESONANT_Q_DB = 20 * Math.log10(Math.SQRT1_2);
