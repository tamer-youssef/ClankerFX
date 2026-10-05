import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRandom } from '../dsp/random';
import { crc32, createZip, readZip, type ZipEntry } from './zip';

const text = (s: string) => new TextEncoder().encode(s);
const entry = (name: string, content: string | Uint8Array): ZipEntry => ({ name, data: typeof content === 'string' ? text(content) : content });
const names = (entries: ZipEntry[] | null) => (entries ?? []).map((e) => e.name);

function randomBytes(length: number, seed: number): Uint8Array {
  const random = createRandom(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(random() * 256);
  return out;
}

describe('crc32', () => {
  it('matches known vectors', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(text('a'))).toBe(0xe8b7be43);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('is unsigned even when the top bit is set', () => {
    const value = crc32(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    expect(value).toBe(0xffffffff);
    expect(value).toBeGreaterThan(0);
  });
});

describe('createZip structure', () => {
  it('writes exact header fields for a single entry', () => {
    const zip = createZip([entry('a.txt', 'hello')]);
    const v = new DataView(zip.buffer);
    const crc = crc32(text('hello'));
    // local header at 0
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(4, true)).toBe(20);
    expect(v.getUint16(6, true)).toBe(0x0800);
    expect(v.getUint16(8, true)).toBe(0);
    expect(v.getUint16(10, true)).toBe(0); // 00:00:00
    expect(v.getUint16(12, true)).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
    expect(v.getUint32(14, true)).toBe(crc);
    expect(v.getUint32(18, true)).toBe(5);
    expect(v.getUint32(22, true)).toBe(5);
    expect(v.getUint16(26, true)).toBe(5);
    expect(v.getUint16(28, true)).toBe(0);
    expect(Array.from(zip.subarray(30, 35))).toEqual(Array.from(text('a.txt')));
    expect(Array.from(zip.subarray(35, 40))).toEqual(Array.from(text('hello')));
    // central directory at 40
    expect(v.getUint32(40, true)).toBe(0x02014b50);
    expect(v.getUint16(44, true)).toBe(20);
    expect(v.getUint16(46, true)).toBe(20);
    expect(v.getUint16(48, true)).toBe(0x0800);
    expect(v.getUint16(50, true)).toBe(0);
    expect(v.getUint16(52, true)).toBe(0);
    expect(v.getUint16(54, true)).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
    expect(v.getUint32(56, true)).toBe(crc);
    expect(v.getUint32(60, true)).toBe(5);
    expect(v.getUint32(64, true)).toBe(5);
    expect(v.getUint16(68, true)).toBe(5);
    expect(v.getUint16(70, true)).toBe(0);
    expect(v.getUint16(72, true)).toBe(0);
    expect(v.getUint16(74, true)).toBe(0);
    expect(v.getUint16(76, true)).toBe(0);
    expect(v.getUint32(78, true)).toBe(0);
    expect(v.getUint32(82, true)).toBe(0); // local header offset
    expect(Array.from(zip.subarray(86, 91))).toEqual(Array.from(text('a.txt')));
    // end of central directory at 91
    expect(v.getUint32(91, true)).toBe(0x06054b50);
    expect(v.getUint16(95, true)).toBe(0);
    expect(v.getUint16(97, true)).toBe(0);
    expect(v.getUint16(99, true)).toBe(1);
    expect(v.getUint16(101, true)).toBe(1);
    expect(v.getUint32(103, true)).toBe(51); // central directory size
    expect(v.getUint32(107, true)).toBe(40); // central directory offset
    expect(v.getUint16(111, true)).toBe(0);
    expect(zip.length).toBe(113);
  });

  it('records correct offsets for multiple entries', () => {
    const zip = createZip([entry('a', 'xx'), entry('bb', ''), entry('c', 'zzz')]);
    const v = new DataView(zip.buffer);
    const endAt = zip.length - 22;
    expect(v.getUint32(endAt, true)).toBe(0x06054b50);
    expect(v.getUint16(endAt + 10, true)).toBe(3);
    const centralStart = v.getUint32(endAt + 16, true);
    expect(v.getUint32(endAt + 12, true)).toBe(3 * 46 + 1 + 2 + 1);
    let pos = centralStart;
    const offsets: number[] = [];
    for (let i = 0; i < 3; i++) {
      expect(v.getUint32(pos, true)).toBe(0x02014b50);
      const offset = v.getUint32(pos + 42, true);
      expect(v.getUint32(offset, true)).toBe(0x04034b50);
      offsets.push(offset);
      pos += 46 + v.getUint16(pos + 28, true);
    }
    expect(offsets).toEqual([0, 30 + 1 + 2, 30 + 1 + 2 + 30 + 2 + 0]);
    expect(pos).toBe(endAt);
  });

  it('writes an empty archive that reads back as empty', () => {
    const zip = createZip([]);
    expect(zip.length).toBe(22);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(readZip(zip)).toEqual([]);
  });

  it('is deterministic by default and honours an explicit date', () => {
    const entries = [entry('a.wav', randomBytes(100, 1)), entry('b.wav', randomBytes(50, 2))];
    expect(createZip(entries)).toEqual(createZip(entries));
    const stamped = createZip(entries, new Date(2024, 5, 15, 13, 46, 58));
    const v = new DataView(stamped.buffer);
    expect(v.getUint16(10, true)).toBe((13 << 11) | (46 << 5) | 29);
    expect(v.getUint16(12, true)).toBe(((2024 - 1980) << 9) | (6 << 5) | 15);
    expect(stamped).not.toEqual(createZip(entries));
  });

  it('clamps dates outside 1980-2107 and tolerates invalid dates', () => {
    const dateOf = (d: Date) => new DataView(createZip([entry('a', '')], d).buffer).getUint16(12, true);
    expect(dateOf(new Date(1970, 0, 1))).toBe((0 << 9) | (1 << 5) | 1);
    expect(dateOf(new Date(2300, 5, 5))).toBe(((2107 - 1980) << 9) | (12 << 5) | 31);
    expect(dateOf(new Date(NaN))).toBe(((2020 - 1980) << 9) | (1 << 5) | 1);
  });

  it('sets the UTF-8 flag and stores UTF-8 names', () => {
    const zip = createZip([entry('héllo ✓.wav', 'x')]);
    const v = new DataView(zip.buffer);
    expect(v.getUint16(6, true) & 0x0800).toBe(0x0800);
    const nameLength = v.getUint16(26, true);
    expect(nameLength).toBe(new TextEncoder().encode('héllo ✓.wav').length);
  });
});

describe('createZip names', () => {
  it('strips leading slashes, backslashes and traversal segments', () => {
    const zip = createZip([
      entry('/abs/path.txt', '1'),
      entry('..\\..\\evil.txt', '2'),
      entry('a/../../b/./c.txt', '3'),
      entry('C:\\dir\\file.txt', '4'),
      entry('///', '5'),
      entry('', '6'),
      entry('..', '7'),
    ]);
    const result = names(readZip(zip));
    expect(result).toEqual(['abs/path.txt', 'evil.txt', 'a/b/c.txt', 'C:/dir/file.txt', 'file', 'file (2)', 'file (3)']);
    for (const n of result) {
      expect(n).not.toMatch(/^\//);
      expect(n.split('/')).not.toContain('..');
      expect(n).not.toContain('\\');
    }
  });

  it('makes duplicate names unique, ignoring case, keeping extensions', () => {
    const zip = createZip([entry('a.wav', '1'), entry('a.wav', '2'), entry('A.WAV', '3'), entry('dir.v2/a', '4'), entry('dir.v2/a', '5'), entry('noext', '6'), entry('noext', '7')]);
    expect(names(readZip(zip))).toEqual(['a.wav', 'a (2).wav', 'A (3).WAV', 'dir.v2/a', 'dir.v2/a (2)', 'noext', 'noext (2)']);
  });

  it('throws a clear error for more than 65535 entries', () => {
    const many = Array.from({ length: 65536 }, (_, i) => entry(`f${i}`, ''));
    expect(() => createZip(many)).toThrow(/Too many files/);
  });

  it('accepts exactly 65535 entries', () => {
    const many = Array.from({ length: 65535 }, (_, i) => entry(`f${i}`, ''));
    const zip = createZip(many);
    // 65535 is the ZIP64 sentinel, which readZip deliberately refuses; 65534 round-trips.
    expect(readZip(zip)).toBeNull();
    expect(readZip(createZip(many.slice(0, 65534)))).toHaveLength(65534);
  });

  it('throws when the archive would reach 4 GiB', () => {
    // A view over one small buffer lying about its length would be unsafe; use fake data objects with a huge length instead.
    const fake = { length: 2 ** 32 } as unknown as Uint8Array;
    expect(() => createZip([{ name: 'big', data: fake }])).toThrow(/4 GiB/);
  });

  it('throws for an over-long name', () => {
    expect(() => createZip([entry('x'.repeat(70000), '')])).toThrow(/too long/);
  });
});

describe('round trip', () => {
  it('restores several entries including an empty file and unicode names', () => {
    const entries = [entry('a.txt', 'hello'), entry('empty.bin', ''), entry('日本語/ファイル ✓.wav', 'données'), entry('émoji 🎛️.txt', '🎚')];
    const back = readZip(createZip(entries));
    expect(back).toEqual(entries);
  });

  it('preserves all 256 byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const back = readZip(createZip([{ name: 'bytes.bin', data: all }]));
    expect(back).toHaveLength(1);
    expect(Array.from(back![0]!.data)).toEqual(Array.from(all));
  });

  it('round-trips 1 MB of random data', () => {
    const big = randomBytes(1024 * 1024, 42);
    const back = readZip(createZip([{ name: 'big.bin', data: big }, entry('after.txt', 'x')]));
    expect(back).toHaveLength(2);
    expect(back![0]!.data.length).toBe(big.length);
    expect(crc32(back![0]!.data)).toBe(crc32(big));
    expect(Buffer.compare(back![0]!.data, big)).toBe(0); // toEqual on 1 MB arrays is very slow
  });

  it('does not alias the input or archive buffers', () => {
    const data = text('abc');
    const zip = createZip([{ name: 'a', data }]);
    data[0] = 0;
    expect(Array.from(readZip(zip)![0]!.data)).toEqual(Array.from(text('abc')));
  });

  it('reads archives given as a subarray view with a byte offset', () => {
    const zip = createZip([entry('a.txt', 'hello')]);
    const padded = new Uint8Array(zip.length + 10);
    padded.set(zip, 5);
    expect(readZip(padded.subarray(5, 5 + zip.length))).toEqual([entry('a.txt', 'hello')]);
  });

  it('tolerates a trailing archive comment', () => {
    const zip = createZip([entry('a.txt', 'hi')]);
    const withComment = new Uint8Array(zip.length + 3);
    withComment.set(zip);
    new DataView(withComment.buffer).setUint16(zip.length - 2, 3, true);
    withComment.set(text('abc'), zip.length);
    expect(readZip(withComment)).toEqual([entry('a.txt', 'hi')]);
  });
});

describe('readZip rejects bad input', () => {
  const good = createZip([entry('a.txt', 'hello world'), entry('b.txt', 'second')]);

  it('returns null for empty, tiny, and garbage input', () => {
    expect(readZip(new Uint8Array(0))).toBeNull();
    expect(readZip(new Uint8Array(21))).toBeNull();
    expect(readZip(text('this is not a zip file at all, definitely'))).toBeNull();
  });

  it('returns null for every truncation of a valid archive', () => {
    for (let n = 0; n < good.length; n++) expect(readZip(good.subarray(0, n))).toBeNull();
  });

  it('detects a corrupted data byte through the CRC', () => {
    const bad = good.slice();
    bad[30 + 5 + 2] = bad[30 + 5 + 2]! ^ 0xff; // inside a.txt's data
    expect(readZip(bad)).toBeNull();
  });

  it('refuses compressed entries', () => {
    const bad = good.slice();
    const v = new DataView(bad.buffer);
    const endAt = bad.length - 22;
    v.setUint16(v.getUint32(endAt + 16, true) + 10, 8, true); // method deflate in first central header
    expect(readZip(bad)).toBeNull();
  });

  it('refuses encrypted entries and mismatched sizes', () => {
    const central = new DataView(good.buffer).getUint32(good.length - 6, true);
    const encrypted = good.slice();
    new DataView(encrypted.buffer).setUint16(central + 8, 0x0801, true);
    expect(readZip(encrypted)).toBeNull();
    const sizes = good.slice();
    new DataView(sizes.buffer).setUint32(central + 24, 3, true);
    expect(readZip(sizes)).toBeNull();
  });

  it('refuses out-of-range local offsets and inflated counts', () => {
    const central = new DataView(good.buffer).getUint32(good.length - 6, true);
    const offset = good.slice();
    new DataView(offset.buffer).setUint32(central + 42, 0x7fffffff, true);
    expect(readZip(offset)).toBeNull();
    const count = good.slice();
    const v = new DataView(count.buffer);
    v.setUint16(count.length - 12, 500, true);
    v.setUint16(count.length - 10, 500, true);
    expect(readZip(count)).toBeNull();
  });
});

describe('readZip fuzz', () => {
  it('never throws on random, truncated and mutated archives', () => {
    const random = createRandom(2024);
    const base = createZip([entry('one.wav', randomBytes(300, 5)), entry('two/二.wav', randomBytes(40, 6)), entry('three', '')]);
    let accepted = 0;

    for (let i = 0; i < 400; i++) {
      let input: Uint8Array;
      const kind = i % 4;
      if (kind === 0) {
        input = randomBytes(Math.floor(random() * 400), i);
      } else if (kind === 1) {
        input = base.slice(0, Math.floor(random() * base.length));
      } else {
        input = base.slice();
        const flips = 1 + Math.floor(random() * 6);
        for (let f = 0; f < flips; f++) input[Math.floor(random() * input.length)] = Math.floor(random() * 256);
        if (kind === 3) input = input.subarray(Math.floor(random() * 10));
      }
      let result: ZipEntry[] | null = null;
      expect(() => {
        result = readZip(input);
      }).not.toThrow();
      if (result) accepted++;
    }
    // Most mutations break a CRC, size or signature; a few harmlessly hit names, comments or timestamps.
    expect(accepted).toBeLessThan(400);
  });

  it('survives every single-byte mutation of a small archive', () => {
    const small = createZip([entry('a', 'xyz'), entry('b', '')]);
    for (let i = 0; i < small.length; i++) {
      for (const value of [0x00, 0xff, small[i]! ^ 0x01]) {
        const mutated = small.slice();
        mutated[i] = value;
        expect(() => readZip(mutated)).not.toThrow();
      }
    }
  });
});

describe('interoperability with Python zipfile', () => {
  const probe = spawnSync('python3', ['--version']);
  const available = probe.status === 0;

  it.skipIf(!available)('is accepted by python3 zipfile (testzip clean, correct names)', () => {
    const entries = [entry('robot_hello_01.wav', randomBytes(5000, 9)), entry('empty.wav', ''), entry('sub dir/ünï ✓.wav', randomBytes(777, 10)), entry('robot_hello_01.wav', 'dup')];
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const file = join(dir, 'out.zip');
      writeFileSync(file, createZip(entries, new Date(2023, 2, 4, 5, 6, 8)));
      const script = [
        'import zipfile,sys',
        'z=zipfile.ZipFile(sys.argv[1])',
        'assert z.testzip() is None',
        'assert all(i.compress_type==0 for i in z.infolist())',
        "print('\\n'.join(z.namelist()))",
      ].join('\n');
      const run = spawnSync('python3', ['-c', script, file], { encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
      expect(run.stdout.trimEnd().split('\n')).toEqual(['robot_hello_01.wav', 'empty.wav', 'sub dir/ünï ✓.wav', 'robot_hello_01 (2).wav']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
