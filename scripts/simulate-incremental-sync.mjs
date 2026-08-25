import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server/loadEnvironment.js';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';
import { QdrantStore } from '../server/rag/qdrantStore.js';
import { syncDocuments } from '../server/sync/incrementalSync.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment();
const code = process.argv.find((value) => value.startsWith('--test-code='))?.split('=')[1] || '16290';
const turnaround = process.argv.find((value) => value.startsWith('--turnaround='))?.split('=')[1] || '3일';
const qdrantUrl = new URL(process.env.QDRANT_URL || 'http://localhost:6333');
if (!['localhost', '127.0.0.1'].includes(qdrantUrl.hostname) || !process.argv.includes('--confirm-local')) {
  throw new Error('이 시뮬레이션은 localhost Qdrant에서 --confirm-local을 지정한 경우에만 실행됩니다.');
}
const documents = JSON.parse(await readFile(resolve(root, 'server/rag/knowledge/scl-tests.json'), 'utf8'));
const targets = documents.filter((document) => document.testCode === code);
if (targets.length !== 1) throw new Error(`검사코드 ${code}가 정확히 한 건이어야 합니다. 실제 ${targets.length}건`);
const simulated = documents.map((document) => document !== targets[0] ? document : {
  ...document,
  turnaroundTime: turnaround,
  content: document.content.replace(/검사 소요일:\s*[^\n]+/u, `검사 소요일: ${turnaround}`),
});
const report = await syncDocuments({
  documents: simulated,
  store: new QdrantStore(),
  embeddingService: new GeminiEmbeddingService(),
});
console.log(JSON.stringify({ simulation: { testCode: code, turnaround }, report }, null, 2));
