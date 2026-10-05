// Development: Vite dev server (hot reload) + Electron pointed at it. Closing the window stops both.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const build = spawn(process.execPath, [join(root, 'scripts', 'build-electron.mjs')], { cwd: root, stdio: 'inherit' });
const built = await new Promise((resolve) => build.on('exit', (code) => resolve(code === 0)));
if (!built) process.exit(1);

const server = await createServer({ root, server: { host: '127.0.0.1' } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('The Vite dev server did not report a URL');

const electronBinary = require('electron');
const args = ['.'];
if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
const child = spawn(electronBinary, args, { cwd: root, stdio: 'inherit', env: { ...process.env, CLANKERFX_DEV_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
