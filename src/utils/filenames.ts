const MAX_NAME_LENGTH = 120;
const MAX_SUFFIX_LENGTH = 40;
const FALLBACK_NAME = 'audio';
// Path separators and characters illegal on Windows (which is the strictest of the three platforms), plus C0/C1 controls.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function codePoints(text: string): string[] {
  return Array.from(text);
}

function trimEdges(text: string): string {
  return text.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').replace(ILLEGAL, '');
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

/** Splits at the last dot, but only when what follows looks like an extension; dotfiles have no extension. */
function splitExtension(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && /^[A-Za-z0-9]{1,10}$/.test(name.slice(dot + 1))) return { stem: name.slice(0, dot), ext: name.slice(dot + 1) };
  return { stem: name, ext: '' };
}

function cleanExtension(extension: string): string {
  return extension.replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
}

/** Windows refuses CON, NUL, COM1… as a base name (with or without extension). */
function guardReserved(stem: string, tail: string): string {
  const firstSegment = `${stem}${tail}`.split('.')[0] ?? '';
  return RESERVED_DEVICE.test(firstSegment) ? `${stem}_` : stem;
}

/** Joins stem + tail + extension, shortening only the stem so the suffix and extension always survive. */
function assemble(stem: string, tail: string, ext: string): string {
  const extPart = ext ? `.${ext}` : '';
  const room = Math.max(1, MAX_NAME_LENGTH - codePoints(tail).length - extPart.length);
  let cut = codePoints(stem);
  if (cut.length > room) cut = cut.slice(0, room);
  const safeStem = guardReserved(trimEdges(cut.join('')) || FALLBACK_NAME, tail);
  return `${safeStem}${tail}${extPart}`;
}

/** Makes an arbitrary string safe to use as a file name on Windows, macOS and Linux. */
export function sanitizeFilename(name: string): string {
  const { stem, ext } = splitExtension(trimEdges(clean(name)));
  return assemble(stem, '', ext);
}

/** Cleans a user-typed filename suffix: no separators or illegal characters, no stray whitespace, bounded length. */
export function parseSuffix(input: string): string {
  const cleaned = clean(input).replace(/^\s+/, '').replace(/[.\s]+$/, '');
  return codePoints(cleaned).slice(0, MAX_SUFFIX_LENGTH).join('');
}

/** 'robot_hello.wav' → 'robot_hello_processed.wav'. Directories and the original extension are dropped. */
export function processedFilename(original: string, suffix = '_processed', extension = 'wav'): string {
  const { stem } = splitExtension(basename(original));
  return assemble(trimEdges(clean(stem)), parseSuffix(suffix), cleanExtension(extension));
}

/** 'robot_attack.wav', 3 → 'robot_attack_03.wav'. `index` is 1-based. */
export function variationFilename(original: string, index: number, extension = 'wav', pad = 2): string {
  const n = Number.isFinite(index) ? Math.max(1, Math.floor(index)) : 1;
  const width = Math.max(1, Math.min(10, Math.floor(pad)));
  const { stem } = splitExtension(basename(original));
  return assemble(trimEdges(clean(stem)), `_${String(n).padStart(width, '0')}`, cleanExtension(extension));
}

/** Sanitises each name and makes them unique ignoring case, keeping order: the second 'a.wav' becomes 'a (2).wav'. */
export function uniqueFilenames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = sanitizeFilename(raw);
    const { stem, ext } = splitExtension(name);
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = assemble(stem, ` (${n})`, ext);
    used.add(candidate.toLowerCase());
    return candidate;
  });
}
