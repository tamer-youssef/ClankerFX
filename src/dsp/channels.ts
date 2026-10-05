export type ChannelTarget = 'auto' | 'mono' | 'stereo';

/** True when every channel matches the first within `epsilon` (a single channel is mono by definition). */
export function isEffectivelyMono(channels: readonly Float32Array[], epsilon = 1e-5): boolean {
  const first = channels[0];
  if (!first) return true;
  for (let c = 1; c < channels.length; c++) {
    const other = channels[c] as Float32Array;
    if (other.length !== first.length) return false;
    for (let i = 0; i < first.length; i++) {
      if (Math.abs((first[i] as number) - (other[i] as number)) > epsilon) return false;
    }
  }
  return true;
}

/** Averages all channels into one. Always returns fresh arrays. */
export function toMono(channels: readonly Float32Array[]): Float32Array[] {
  const first = channels[0];
  if (!first) return [];
  if (channels.length === 1) return [new Float32Array(first)];
  const out = new Float32Array(first.length);
  const inverse = 1 / channels.length;
  for (const ch of channels) {
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (ch[i] as number) * inverse;
  }
  return [out];
}

/** Duplicates mono into two independent arrays; stereo passes through unchanged (same arrays); extra channels are dropped. */
export function toStereo(channels: readonly Float32Array[]): Float32Array[] {
  const [left, right] = channels;
  if (!left) return [];
  if (!right) return [new Float32Array(left), new Float32Array(left)];
  return [left, right];
}

/** 'auto' picks mono when the channels are effectively identical, stereo otherwise. */
export function convertChannels(channels: readonly Float32Array[], target: ChannelTarget): Float32Array[] {
  const mono = target === 'mono' || (target === 'auto' && isEffectivelyMono(channels));
  return mono ? toMono(channels) : toStereo(channels);
}
