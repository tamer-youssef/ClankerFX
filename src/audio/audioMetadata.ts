const MIN_PLAUSIBLE_RATE = 8000;
const MAX_PLAUSIBLE_RATE = 384000;
const SNIFF_BYTES = 64 * 1024;

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function wavRate(bytes: Uint8Array): number | null {
  const id = tag(bytes, 0);
  if ((id !== 'RIFF' && id !== 'RF64' && id !== 'BW64') || tag(bytes, 8) !== 'WAVE') return null;
  let pos = 12;
  // Walk chunks (JUNK, bext, ds64 ... may precede fmt). Sizes in RF64 data chunks are bogus, but fmt always comes first.
  while (pos + 8 <= bytes.length) {
    const size = u32(bytes, pos + 4);
    if (tag(bytes, pos) === 'fmt ') {
      return size >= 16 && pos + 8 + 8 <= bytes.length ? u32(bytes, pos + 12) : null;
    }
    const next = pos + 8 + size + (size % 2);
    if (next <= pos) return null;
    pos = next;
  }
  return null;
}

function flacRate(bytes: Uint8Array): number | null {
  if (tag(bytes, 0) !== 'fLaC') return null;
  // The first metadata block must be STREAMINFO (type 0, 34 bytes). Sample rate is the 20 bits after 10 bytes of block/frame sizes.
  if (((bytes[4] ?? 0) & 0x7f) !== 0 || bytes.length < 8 + 14) return null;
  return ((bytes[18] ?? 0) << 12) | ((bytes[19] ?? 0) << 4) | ((bytes[20] ?? 0) >> 4);
}

/** Reads the stored sample rate from a WAV or FLAC header. Returns null for other formats, damaged headers, or implausible rates. */
export function sniffSourceSampleRate(input: ArrayBuffer | Uint8Array): number | null {
  try {
    const all = input instanceof Uint8Array ? input : new Uint8Array(input);
    const bytes = all.subarray(0, SNIFF_BYTES);
    const rate = wavRate(bytes) ?? flacRate(bytes);
    return rate !== null && rate >= MIN_PLAUSIBLE_RATE && rate <= MAX_PLAUSIBLE_RATE ? rate : null;
  } catch {
    return null;
  }
}
