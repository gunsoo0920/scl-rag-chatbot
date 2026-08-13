import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 4173;
const baseUrl = `http://${host}:${port}`;
const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const playwrightCli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer(child, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Vite test server exited before becoming ready (${child.exitCode}).`);
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Vite test server did not start within ${timeoutMs}ms.`);
}

const vite = spawn(process.execPath, [
  viteCli,
  '--host', host,
  '--port', String(port),
  '--strictPort',
], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'ignore',
  windowsHide: true,
});

try {
  await waitForServer(vite);

  const playwright = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      PLAYWRIGHT_REUSE_SERVER: '1',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  const { code, signal } = await waitForExit(playwright);

  if (signal) {
    throw new Error(`Playwright was terminated by ${signal}.`);
  }

  process.exitCode = code ?? 1;
} finally {
  if (vite.exitCode === null) {
    vite.kill();
    await Promise.race([
      waitForExit(vite),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}
