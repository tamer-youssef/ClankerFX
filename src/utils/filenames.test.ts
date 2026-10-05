import { describe, expect, it } from 'vitest';
import { parseSuffix, processedFilename, sanitizeFilename, uniqueFilenames, variationFilename } from './filenames';

const SAFE = /^[^\\/:*?"<>|\u0000-\u001f]+$/;
const expectSafe = (name: string) => {
  expect(name).toMatch(SAFE);
  expect(name).not.toMatch(/[. ]$/);
  expect(name).not.toMatch(/^[. ]/);
  expect(Array.from(name).length).toBeLessThanOrEqual(120);
  expect(name.length).toBeGreaterThan(0);
};

describe('processedFilename', () => {
  it('appends the suffix and swaps the extension', () => {
    expect(processedFilename('robot_hello.wav')).toBe('robot_hello_processed.wav');
    expect(processedFilename('voice.mp3')).toBe('voice_processed.wav');
    expect(processedFilename('a.b.mp3')).toBe('a.b_processed.wav');
    expect(processedFilename('noext')).toBe('noext_processed.wav');
  });

  it('strips directories of both styles', () => {
    expect(processedFilename('/home/me/clips/take 1.flac')).toBe('take 1_processed.wav');
    expect(processedFilename('C:\\Users\\me\\take.wav')).toBe('take_processed.wav');
    expect(processedFilename('../../etc/passwd')).toBe('passwd_processed.wav');
  });

  it('supports custom suffix and extension, including empty and blank suffixes', () => {
    expect(processedFilename('a.wav', '_fx', 'flac')).toBe('a_fx.flac');
    expect(processedFilename('a.mp3', '')).toBe('a.wav');
    expect(processedFilename('a.mp3', '   ')).toBe('a.wav');
    expect(processedFilename('a.wav', '_x', '.WAV')).toBe('a_x.WAV');
  });

  it('sanitises hostile suffixes', () => {
    expect(processedFilename('a.wav', '/../evil')).toBe('a..evil.wav');
    expect(processedFilename('a.wav', '_<b>:"x"?')).toBe('a_bx.wav');
  });

  it('handles dotfiles, trailing dots, unicode and reserved characters', () => {
    expect(processedFilename('.hidden')).toBe('hidden_processed.wav');
    expect(processedFilename('.hidden.wav')).toBe('hidden_processed.wav');
    expect(processedFilename('clip...')).toBe('clip_processed.wav');
    expect(processedFilename('café ☕ voz.wav')).toBe('café ☕ voz_processed.wav');
    expect(processedFilename('日本語.mp3')).toBe('日本語_processed.wav');
    expect(processedFilename('a:b*c?.wav')).toBe('abc_processed.wav');
    expect(processedFilename('')).toBe('audio_processed.wav');
    expect(processedFilename('   ')).toBe('audio_processed.wav');
    expect(processedFilename('CON.wav')).toBe('CON_processed.wav');
    expect(processedFilename('CON.wav', '')).toBe('CON_.wav');
  });

  it('keeps suffix and extension when the name is very long', () => {
    const out = processedFilename(`${'x'.repeat(300)}.wav`);
    expect(out.endsWith('_processed.wav')).toBe(true);
    expect(Array.from(out).length).toBe(120);
    const emoji = processedFilename(`${'😀'.repeat(200)}.wav`);
    expect(Array.from(emoji).length).toBeLessThanOrEqual(120);
    expect(emoji.endsWith('_processed.wav')).toBe(true);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/); // no split surrogate pairs
  });

  it('always returns filename-safe strings', () => {
    for (const input of ['a/b\\c', '***', '....', ' . ', '\u0000\u0007.wav', 'x'.repeat(500), 'nul', 'COM1.txt', 'a\tb\nc.wav']) {
      expectSafe(processedFilename(input));
    }
  });
});

describe('variationFilename', () => {
  it('numbers variations with zero padding', () => {
    expect(variationFilename('robot_attack.wav', 3)).toBe('robot_attack_03.wav');
    expect(variationFilename('robot_attack.wav', 12)).toBe('robot_attack_12.wav');
    expect(variationFilename('robot_attack.wav', 123)).toBe('robot_attack_123.wav');
    expect(variationFilename('a.wav', 7, 'wav', 3)).toBe('a_007.wav');
    expect(variationFilename('a.wav', 7, 'flac', 1)).toBe('a_7.flac');
  });

  it('clamps bad indices to 1 and strips paths and extensions', () => {
    expect(variationFilename('a.wav', 0)).toBe('a_01.wav');
    expect(variationFilename('a.wav', -4)).toBe('a_01.wav');
    expect(variationFilename('a.wav', NaN)).toBe('a_01.wav');
    expect(variationFilename('a.wav', 2.9)).toBe('a_02.wav');
    expect(variationFilename('dir/sub/a.b.mp3', 5)).toBe('a.b_05.wav');
    expect(variationFilename('', 1)).toBe('audio_01.wav');
  });

  it('keeps the number when the name is very long', () => {
    const out = variationFilename(`${'y'.repeat(400)}.wav`, 9);
    expect(out.endsWith('_09.wav')).toBe(true);
    expectSafe(out);
  });
});

describe('sanitizeFilename', () => {
  it('removes separators, illegal characters and control characters', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j.wav')).toBe('abcdefghij.wav');
    expect(sanitizeFilename('a\u0000b\u001fc\u007fd.wav')).toBe('abcd.wav');
  });

  it('trims dots and spaces at the ends and collapses whitespace', () => {
    expect(sanitizeFilename('  .. my   file ..  ')).toBe('my file');
    expect(sanitizeFilename('a \t\n b.wav')).toBe('a b.wav');
    expect(sanitizeFilename('name.wav. ')).toBe('name.wav');
  });

  it('falls back to "audio"', () => {
    for (const input of ['', ' ', '...', '/\\:*?', '\u0000']) expect(sanitizeFilename(input)).toBe('audio');
  });

  it('caps the length at 120 code points while preserving the extension', () => {
    const out = sanitizeFilename(`${'a'.repeat(200)}.flac`);
    expect(Array.from(out).length).toBe(120);
    expect(out.endsWith('.flac')).toBe(true);
    expect(sanitizeFilename('b'.repeat(200))).toBe('b'.repeat(120));
    expect(sanitizeFilename('short.wav')).toBe('short.wav');
  });

  it('does not treat a long dotted tail as an extension', () => {
    const out = sanitizeFilename(`${'a'.repeat(200)}.notanextension`);
    expect(Array.from(out).length).toBe(120);
  });

  it('keeps unicode and dotfile-ish names sensible', () => {
    expect(sanitizeFilename('Zażółć gęślą jaźń.wav')).toBe('Zażółć gęślą jaźń.wav');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('archive.tar.gz')).toBe('archive.tar.gz');
  });

  it('defuses Windows reserved device names', () => {
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('nul.txt')).toBe('nul_.txt');
    expect(sanitizeFilename('com1.wav')).toBe('com1_.wav');
    expect(sanitizeFilename('console.wav')).toBe('console.wav');
  });

  it('is idempotent', () => {
    for (const input of ['a/b.wav', ' x ', 'y'.repeat(300) + '.wav', 'CON.wav', '😀'.repeat(150)]) {
      const once = sanitizeFilename(input);
      expect(sanitizeFilename(once)).toBe(once);
    }
  });
});

describe('uniqueFilenames', () => {
  it('numbers duplicates case-insensitively, keeping order', () => {
    expect(uniqueFilenames(['a.wav', 'b.wav', 'A.WAV', 'a.wav'])).toEqual(['a.wav', 'b.wav', 'A (2).WAV', 'a (3).wav']);
  });

  it('works without extensions and does not collide with generated names', () => {
    expect(uniqueFilenames(['x', 'x', 'x (2)'])).toEqual(['x', 'x (2)', 'x (2) (2)']);
    expect(uniqueFilenames([])).toEqual([]);
  });

  it('sanitises names and de-duplicates the sanitised result', () => {
    expect(uniqueFilenames(['a/b.wav', 'ab.wav'])).toEqual(['ab.wav', 'ab (2).wav']);
  });

  it('keeps long names within the limit', () => {
    const long = `${'z'.repeat(200)}.wav`;
    const out = uniqueFilenames([long, long]);
    expect(out[0]).not.toBe(out[1]);
    for (const name of out) expectSafe(name);
    expect(out[1]?.endsWith(' (2).wav')).toBe(true);
  });
});

describe('parseSuffix', () => {
  it('keeps normal suffixes and removes unsafe characters', () => {
    expect(parseSuffix('_processed')).toBe('_processed');
    expect(parseSuffix('_fx v2')).toBe('_fx v2');
    expect(parseSuffix('../../x')).toBe('....x');
    expect(parseSuffix('a/b\\c:d')).toBe('abcd');
    expect(parseSuffix('_ok<>|?*"')).toBe('_ok');
  });

  it('trims whitespace and trailing dots, and bounds the length', () => {
    expect(parseSuffix('   _x  ')).toBe('_x');
    expect(parseSuffix('_x...')).toBe('_x');
    expect(parseSuffix('')).toBe('');
    expect(parseSuffix(' \t ')).toBe('');
    expect(Array.from(parseSuffix('s'.repeat(500))).length).toBe(40);
    expect(parseSuffix('a\u0000b\nc')).toBe('ab c');
  });
});
