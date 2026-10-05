// Compiles electron/*.ts to CommonJS in electron-dist/. The app's package.json is "type": "module", so the output needs its
// own package.json marking it CommonJS (Electron's sandboxed preload must be CommonJS).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');

rmSync(join(root, 'electron-dist'), { recursive: true, force: true });
const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'electron', 'tsconfig.build.json')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

mkdirSync(join(root, 'electron-dist'), { recursive: true });
writeFileSync(join(root, 'electron-dist', 'package.json'), '{ "type": "commonjs" }\n');
