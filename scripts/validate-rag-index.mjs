import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server/loadEnvironment.js';
import { validateVectorIndex, vectorMagnitude } from '../server/rag/vectorStore.js';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const KNOWLEDGE_PATH = resolve(PROJECT_ROOT, 'server', 'rag', 'knowledge', 'scl-tests.json');
const INDEX_PATH = resolve(PROJECT_ROOT, 'server', 'rag', 'index', 'vector-index.json');

function documentHash(document) {
  return createHash('sha256').update(`${document.title}\n${document.content}`).digest('hex');
}

async function main() {
  loadEnvironment();
  const documents = JSON.parse(await readFile(KNOWLEDGE_PATH, 'utf8'));
  let index;
  try {
    index = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('vector-index.json이 없습니다. 먼저 npm run rag:index를 실행하세요.');
    throw error;
  }

  const expectedIds = documents.map((document) => document.id);
  const validation = validateVectorIndex(index, { expectedDocumentIds: expectedIds });
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const staleEntries = index.vectors.filter((entry) => {
    const document = documentById.get(entry.id);
    return document && entry.contentHash !== documentHash(document);
  });
  if (staleEntries.length > 0) validation.errors.push(`${staleEntries.length}개 벡터의 원문 hash가 변경되었습니다.`);
  if (index.model !== (process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001').replace(/^models\//, '')) {
    validation.errors.push(`model 불일치: ${index.model}`);
  }
  if (index.dimension !== Number(process.env.GEMINI_EMBEDDING_DIMENSION || 768)) {
    validation.errors.push(`dimension 불일치: ${index.dimension}`);
  }
  validation.valid = validation.errors.length === 0;

  const norms = index.vectors.map((entry) => vectorMagnitude(entry.values));
  console.log('SCL RAG Vector Index Validation');
  console.log(`Knowledge documents: ${documents.length}`);
  console.log(`Indexed documents: ${index.vectors.length}`);
  console.log(`Model: ${index.model}`);
  console.log(`Dimension: ${index.dimension}`);
  console.log(`Minimum norm: ${Math.min(...norms).toFixed(8)}`);
  console.log(`Maximum norm: ${Math.max(...norms).toFixed(8)}`);
  console.log(`Stale content hashes: ${staleEntries.length}`);
  console.log(`Errors: ${validation.errors.length}`);

  if (!validation.valid) {
    for (const error of validation.errors.slice(0, 20)) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('Result: PASS');
}

main().catch((error) => {
  console.error(`Vector index validation failed: ${error.message}`);
  process.exitCode = 1;
});
