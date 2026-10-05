import { createRandom } from '../dsp/random';

export interface WavEncodeOptions {
  bitDepth: 16 | 24;
  /** TPDF dither before 16-bit quantisation. Default true; ignored for 24-bit. */
  dither?: boolean;
  /** Seed for the dither noise so identical input gives identical bytes. */
  seed?: number;
}

export interface WavEncodeResult {
  bytes: Uint8Array<ArrayBuffer>;
  /** Number of input samples outside [-1, 1] (before clamping). NaN is written as silence and not counted. */
  clippedSamples: number;
  /** Largest absolute input sample (before clamping); 0 for empty or all-NaN input. */
  peak: number;
}

export interface DecodedWav {
  channels: Float32Array[];
  sampleRate: number;
  bitDepth: number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const HEADER_BYTES = 44;
const MAX_DECODE_CHANNELS = 32;
const MAX_UINT32 = 0xffffffff;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Encodes 1–2 channels of float samples as a canonical 44-byte-header PCM WAV. */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number, options: WavEncodeOptions): WavEncodeResult {
  const channelCount = channels.length;
  if (channelCount < 1 || channelCount > 2) {
    throw new Error(`WAV export supports 1 or 2 channels, got ${channelCount}.`);
  }
  const frames = (channels[0] as Float32Array).length;
  if (channels.some((c) => c.length !== frames)) {
    throw new Error('All channels must have the same length.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > MAX_UINT32) {
    throw new Error(`Invalid sample rate: ${sampleRate}.`);
  }
  const { bitDepth } = options;
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error(`Unsupported bit depth: ${String(bitDepth)}.`);

  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frames * blockAlign;
  // RIFF chunks are word-aligned: odd-sized data (24-bit mono) gets a pad byte that is not counted in the data size.
  const pad = dataSize % 2;
  const total = HEADER_BYTES + dataSize + pad;
  if (total - 8 > MAX_UINT32) throw new Error('Audio is too long for a WAV file (over 4 GB).');

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, total - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const fullScale = bitDepth === 16 ? 32767 : 8388607;
  const dither = bitDepth === 16 && options.dither !== false;
  const random = createRandom(options.seed ?? 0x6d766f78);
  let clipped = 0;
  let peak = 0;
  let offset = HEADER_BYTES;

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      let x = (channels[c] as Float32Array)[i] as number;
      if (Number.isNaN(x)) {
        x = 0;
      } else {
        const a = Math.abs(x);
        if (a > peak) peak = a;
        if (a > 1) {
          clipped++;
          x = x > 0 ? 1 : -1;
        }
      }
      let scaled = x * fullScale;
      if (dither) scaled += random() - random();
      // Round half away from zero so +x and -x quantise symmetrically.
      let q = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
      if (q > fullScale) q = fullScale;
      else if (q < -fullScale) q = -fullScale;

      if (bitDepth === 16) {
        view.setInt16(offset, q, true);
      } else {
        const u = q & 0xffffff;
        bytes[offset] = u & 0xff;
        bytes[offset + 1] = (u >>> 8) & 0xff;
        bytes[offset + 2] = (u >>> 16) & 0xff;
      }
      offset += bytesPerSample;
    }
  }

  return { bytes, clippedSamples: clipped, peak };
}

interface WavFormat {
  tag: number;
  channels: number;
  sampleRate: number;
  bits: number;
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function looksLikeChunkHeader(view: DataView, offset: number): boolean {
  if (offset + 8 > view.byteLength) return false;
  for (let i = 0; i < 4; i++) {
    const b = view.getUint8(offset + i);
    if (b < 0x20 || b > 0x7e) return false;
  }
  return view.getUint32(offset + 4, true) <= view.byteLength - offset - 8;
}

function parseFormat(view: DataView, offset: number, size: number): WavFormat | null {
  if (size < 16 || offset + size > view.byteLength) return null;
  let tag = view.getUint16(offset, true);
  const channels = view.getUint16(offset + 2, true);
  const sampleRate = view.getUint32(offset + 4, true);
  const bits = view.getUint16(offset + 14, true);
  if (tag === WAVE_FORMAT_EXTENSIBLE) {
    // cbSize(2) validBits(2) channelMask(4) then the sub-format GUID, whose first two bytes are the real tag.
    if (size < 40) return null;
    tag = view.getUint16(offset + 24, true);
  }
  return { tag, channels, sampleRate, bits };
}

function decodeSamples(view: DataView, start: number, length: number, fmt: WavFormat): Float32Array[] | null {
  const bytesPerSample = fmt.bits / 8;
  const frameBytes = bytesPerSample * fmt.channels;
  const frames = Math.floor(length / frameBytes);
  const out = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const isFloat = fmt.tag === WAVE_FORMAT_IEEE_FLOAT;
  let offset = start;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      let v: number;
      if (isFloat) {
        v = view.getFloat32(offset, true);
        if (!Number.isFinite(v)) v = 0;
      } else if (fmt.bits === 16) {
        v = view.getInt16(offset, true) / 32768;
      } else if (fmt.bits === 24) {
        const raw = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
        v = ((raw << 8) >> 8) / 8388608;
      } else {
        v = view.getInt32(offset, true) / 2147483648;
      }
      (out[c] as Float32Array)[i] = v;
      offset += bytesPerSample;
    }
  }
  return out;
}

/** Decodes 16/24/32-bit PCM and 32-bit float WAVs. Returns null for anything unsupported or malformed; never throws. */
export function decodeWav(bytes: Uint8Array): DecodedWav | null {
  try {
    if (bytes.byteLength < 12) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') return null;

    let fmt: WavFormat | null = null;
    let dataStart = -1;
    let dataLength = 0;
    let pos = 12;
    while (pos + 8 <= view.byteLength) {
      const id = fourCC(view, pos);
      const size = view.getUint32(pos + 4, true);
      const body = pos + 8;
      const remaining = view.byteLength - body;
      if (id === 'fmt ') {
        if (fmt) return null;
        fmt = parseFormat(view, body, Math.min(size, remaining));
        if (!fmt) return null;
      } else if (id === 'data') {
        if (dataStart >= 0) return null;
        // Streaming writers leave 0 or 0xFFFFFFFF; a genuinely empty chunk is followed by another valid chunk or nothing.
        const streaming = size === MAX_UINT32 || (size === 0 && remaining > 0 && !looksLikeChunkHeader(view, body));
        dataStart = body;
        dataLength = streaming ? remaining : Math.min(size, remaining);
        if (streaming || size >= remaining) break;
      }
      const next = body + size + (size % 2);
      if (next <= pos) return null;
      pos = next;
    }

    if (!fmt || dataStart < 0) return null;
    const { tag, channels, bits, sampleRate } = fmt;
    if (channels < 1 || channels > MAX_DECODE_CHANNELS) return null;
    if (sampleRate < 1 || sampleRate > 10_000_000) return null;
    const supported =
      (tag === WAVE_FORMAT_PCM && (bits === 16 || bits === 24 || bits === 32)) || (tag === WAVE_FORMAT_IEEE_FLOAT && bits === 32);
    if (!supported) return null;

    const decoded = decodeSamples(view, dataStart, dataLength, fmt);
    return decoded ? { channels: decoded, sampleRate, bitDepth: bits } : null;
  } catch {
    return null;
  }
}
