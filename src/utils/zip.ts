/**
 * Minimal ZIP writer/reader. STORE method only (audio does not compress), no ZIP64, no data descriptors.
 * Every archive written here is accepted by standard unzip tools.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_SIZE = 22;
const VERSION = 20;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const MAX_ENTRIES = 0xffff;
const MAX_U32 = 0xffffffff;
const MAX_ARCHIVE_BYTES = 2 ** 32; // exclusive: offsets and sizes must fit 32 bits
const DEFAULT_DATE = new Date(2020, 0, 1, 0, 0, 0);

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** Standard IEEE CRC-32 (as used by ZIP, PNG, gzip), returned as an unsigned integer. */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time pair (local time, 2 s resolution). Years outside 1980–2107 clamp to the range ends. */
function dosDateTime(date: Date): { time: number; date: number } {
  const source = Number.isNaN(date.getTime()) ? DEFAULT_DATE : date;
  let year = source.getFullYear();
  let month = source.getMonth() + 1;
  let day = source.getDate();
  let hours = source.getHours();
  let minutes = source.getMinutes();
  let seconds = source.getSeconds();
  if (year < 1980) [year, month, day, hours, minutes, seconds] = [1980, 1, 1, 0, 0, 0];
  else if (year > 2107) [year, month, day, hours, minutes, seconds] = [2107, 12, 31, 23, 59, 58];
  return { time: (hours << 11) | (minutes << 5) | (seconds >> 1), date: ((year - 1980) << 9) | (month << 5) | day };
}

/** Archive-relative path: forward slashes only, no leading slash, no '.' or '..' segments, never empty. */
function sanitizeEntryName(name: string): string {
  const segments = name.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.' && s !== '..');
  return segments.join('/') || 'file';
}

function uniqueEntryNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = sanitizeEntryName(raw);
    const dot = name.lastIndexOf('.');
    const slash = name.lastIndexOf('/');
    const hasExt = dot > slash + 1;
    const stem = hasExt ? name.slice(0, dot) : name;
    const ext = hasExt ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Builds a STORE-only archive. Deterministic: without `date` every entry is stamped 2020-01-01 00:00:00. */
export function createZip(entries: readonly ZipEntry[], date: Date = DEFAULT_DATE): Uint8Array<ArrayBuffer> {
  if (entries.length > MAX_ENTRIES) throw new Error(`Too many files for a ZIP archive (${entries.length}; the limit is ${MAX_ENTRIES}).`);

  const encoder = new TextEncoder();
  const names = uniqueEntryNames(entries.map((e) => e.name)).map((n) => encoder.encode(n));
  for (const name of names) {
    if (name.length > 0xffff) throw new Error('A file name inside the ZIP archive is too long.');
  }

  let total = END_SIZE;
  for (const [i, entry] of entries.entries()) {
    total += LOCAL_HEADER_SIZE + CENTRAL_HEADER_SIZE + 2 * names[i]!.length + entry.data.length;
    if (total >= MAX_ARCHIVE_BYTES) throw new Error('The ZIP archive would be 4 GiB or larger, which is not supported.');
  }

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const stamp = dosDateTime(date);
  const central: { offset: number; crc: number; size: number; name: Uint8Array }[] = [];
  let pos = 0;

  for (const [i, entry] of entries.entries()) {
    const name = names[i]!;
    const crc = crc32(entry.data);
    central.push({ offset: pos, crc, size: entry.data.length, name });
    view.setUint32(pos, SIG_LOCAL, true);
    view.setUint16(pos + 4, VERSION, true);
    view.setUint16(pos + 6, FLAG_UTF8, true);
    view.setUint16(pos + 8, 0, true); // method: store
    view.setUint16(pos + 10, stamp.time, true);
    view.setUint16(pos + 12, stamp.date, true);
    view.setUint32(pos + 14, crc, true);
    view.setUint32(pos + 18, entry.data.length, true);
    view.setUint32(pos + 22, entry.data.length, true);
    view.setUint16(pos + 26, name.length, true);
    view.setUint16(pos + 28, 0, true); // extra length
    out.set(name, pos + LOCAL_HEADER_SIZE);
    out.set(entry.data, pos + LOCAL_HEADER_SIZE + name.length);
    pos += LOCAL_HEADER_SIZE + name.length + entry.data.length;
  }

  const centralStart = pos;
  for (const item of central) {
    view.setUint32(pos, SIG_CENTRAL, true);
    view.setUint16(pos + 4, VERSION, true); // version made by
    view.setUint16(pos + 6, VERSION, true); // version needed
    view.setUint16(pos + 8, FLAG_UTF8, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, stamp.time, true);
    view.setUint16(pos + 14, stamp.date, true);
    view.setUint32(pos + 16, item.crc, true);
    view.setUint32(pos + 20, item.size, true);
    view.setUint32(pos + 24, item.size, true);
    view.setUint16(pos + 28, item.name.length, true);
    // extra length, comment length, disk number, internal and external attributes stay 0
    view.setUint32(pos + 42, item.offset, true);
    out.set(item.name, pos + CENTRAL_HEADER_SIZE);
    pos += CENTRAL_HEADER_SIZE + item.name.length;
  }

  view.setUint32(pos, SIG_END, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, pos - centralStart, true);
  view.setUint32(pos + 16, centralStart, true);
  return out;
}

/**
 * Reads a STORE-only archive such as the ones createZip writes. Returns null (never throws) for anything malformed,
 * truncated, compressed, encrypted, multi-disk or ZIP64, and when any entry's CRC-32 does not match.
 * Names are returned as stored; callers extracting to disk must sanitise them.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] | null {
  try {
    return parseZip(bytes);
  } catch {
    return null;
  }
}

function parseZip(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.length < END_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record may be followed by a comment of up to 65535 bytes.
  let end = -1;
  for (let i = bytes.length - END_SIZE; i >= Math.max(0, bytes.length - END_SIZE - 0xffff); i--) {
    if (view.getUint32(i, true) === SIG_END && i + END_SIZE + view.getUint16(i + 20, true) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;

  const diskNumber = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const countOnDisk = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || countOnDisk !== count) return null;
  if (count === MAX_ENTRIES || centralSize === MAX_U32 || centralStart === MAX_U32) return null; // ZIP64 markers
  if (centralStart + centralSize > end) return null;

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let pos = centralStart;
  for (let n = 0; n < count; n++) {
    if (pos + CENTRAL_HEADER_SIZE > end || view.getUint32(pos, true) !== SIG_CENTRAL) return null;
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    if (method !== 0 || flags & FLAG_ENCRYPTED || compressedSize !== size || size === MAX_U32 || localOffset === MAX_U32) return null;

    const nameStart = pos + CENTRAL_HEADER_SIZE;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > end) return null;

    if (localOffset + LOCAL_HEADER_SIZE > centralStart || view.getUint32(localOffset, true) !== SIG_LOCAL) return null;
    const dataStart = localOffset + LOCAL_HEADER_SIZE + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + size > centralStart) return null;

    const data = bytes.slice(dataStart, dataStart + size);
    if (crc32(data) !== crc) return null;
    entries.push({ name: decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)), data });
    pos = next;
  }
  return entries;
}
