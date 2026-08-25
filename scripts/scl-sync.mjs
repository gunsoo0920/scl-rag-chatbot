import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server/loadEnvironment.js';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';
import { QdrantStore } from '../server/rag/qdrantStore.js';
import { syncDocuments } from '../server/sync/incrementalSync.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment();

function runScript(relativePath, args = []) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, relativePath), ...args], { cwd: root, stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${relativePath} 종료 코드: ${code}`)));
  });
}

if (!process.argv.includes('--skip-crawl')) {
  await runScript('scripts/crawl-scl-tests.mjs', ['--all']);
  await runScript('scripts/crawl-scl-test-details.mjs', ['--all']);
  await runScript('scripts/build-scl-test-knowledge.mjs');
}

const [documents, failureRecords] = await Promise.all([
  readFile(resolve(root, 'server/rag/knowledge/scl-tests.json'), 'utf8').then(JSON.parse),
  readFile(resolve(root, 'data/raw/scl-test-details-failures.json'), 'utf8').then(JSON.parse),
]);
const store = new QdrantStore();
const embeddingService = process.env.GEMINI_API_KEY?.trim() ? new GeminiEmbeddingService() : null;
const report = await syncDocuments({ documents, store, embeddingService, failures: failureRecords.length });
console.log(JSON.stringify(report, null, 2));
