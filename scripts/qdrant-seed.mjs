import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server/loadEnvironment.js';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';
import { QdrantStore } from '../server/rag/qdrantStore.js';
import { legacyVectorMap, syncDocuments } from '../server/sync/incrementalSync.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnvironment();
const documents = JSON.parse(await readFile(resolve(root, 'server/rag/knowledge/scl-tests.json'), 'utf8'));
let legacyVectors = new Map();
try {
  const legacy = JSON.parse(await readFile(resolve(root, 'server/rag/index/vector-index.json'), 'utf8'));
  legacyVectors = legacyVectorMap(legacy);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const store = new QdrantStore();
const embeddingService = process.env.GEMINI_API_KEY?.trim() ? new GeminiEmbeddingService() : null;
const report = await syncDocuments({ documents, store, embeddingService, legacyVectors });
console.log(JSON.stringify(report, null, 2));
