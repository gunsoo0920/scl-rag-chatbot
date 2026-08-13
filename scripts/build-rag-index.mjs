import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../server/loadEnvironment.js';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';
import { validateVectorIndex } from '../server/rag/vectorStore.js';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const KNOWLEDGE_PATH = resolve(PROJECT_ROOT, 'server', 'rag', 'knowledge', 'scl-tests.json');
const INDEX_DIRECTORY = resolve(PROJECT_ROOT, 'server', 'rag', 'index');
const INDEX_PATH = resolve(INDEX_DIRECTORY, 'vector-index.json');
const CHECKPOINT_ROOT = resolve(INDEX_DIRECTORY, 'checkpoints');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function documentHash(document) {
  return sha256(`${document.title}\n${document.content}`);
}

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name}은(는) 양의 정수여야 합니다.`);
  return parsed;
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

function checkpointIsReusable(checkpoint, expectedDocuments, buildSignature, dimension) {
  if (checkpoint?.buildSignature !== buildSignature || !Array.isArray(checkpoint?.vectors)) return false;
  if (checkpoint.vectors.length !== expectedDocuments.length) return false;
  return checkpoint.vectors.every((entry, index) => {
    const expected = expectedDocuments[index];
    if (entry.id !== expected.id || entry.contentHash !== expected.contentHash) return false;
    if (!Array.isArray(entry.values) || entry.values.length !== dimension || !entry.values.every(Number.isFinite)) return false;
    const norm = Math.sqrt(entry.values.reduce((sum, value) => sum + value * value, 0));
    return Math.abs(norm - 1) <= 1e-5;
  });
}

function vectorEntry(document, contentHash, values) {
  return {
    id: document.id,
    sourceRecordId: document.sourceRecordId,
    type: document.type,
    title: document.title,
    testCode: document.testCode,
    sampleCode: document.sampleCode,
    testName: document.testName,
    sourceUrl: document.sourceUrl,
    contentHash,
    values,
  };
}

async function main() {
  loadEnvironment();

  const model = (process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001').replace(/^models\//, '');
  const dimension = positiveInteger(process.env.GEMINI_EMBEDDING_DIMENSION, 768, 'GEMINI_EMBEDDING_DIMENSION');
  const batchSize = positiveInteger(process.env.GEMINI_EMBEDDING_BATCH_SIZE, 20, 'GEMINI_EMBEDDING_BATCH_SIZE');
  const requestDelayMs = Math.max(0, Number(process.env.GEMINI_EMBEDDING_REQUEST_DELAY_MS || 250));
  const quotaRetryDelayMs = positiveInteger(
    process.env.GEMINI_EMBEDDING_BUILD_QUOTA_RETRY_DELAY_MS,
    60000,
    'GEMINI_EMBEDDING_BUILD_QUOTA_RETRY_DELAY_MS',
  );
  const documents = JSON.parse(await readFile(KNOWLEDGE_PATH, 'utf8'));
  if (!Array.isArray(documents) || documents.length === 0) throw new Error('RAG knowledge 문서가 비어 있습니다.');

  const preparedDocuments = documents.map((document) => ({
    ...document,
    contentHash: documentHash(document),
  }));
  const knowledgeHash = sha256(JSON.stringify(preparedDocuments.map(({ id, contentHash }) => ({ id, contentHash }))));
  const buildSignature = sha256(JSON.stringify({ model, dimension, batchSize, knowledgeHash }));
  const expectedIds = documents.map((document) => document.id);

  const existingIndex = await readJsonIfPresent(INDEX_PATH);
  if (existingIndex?.buildSignature === buildSignature) {
    const validation = validateVectorIndex(existingIndex, { expectedDocumentIds: expectedIds });
    if (validation.valid) {
      console.log(`Vector index is already current: ${INDEX_PATH}`);
      console.log(`Documents: ${existingIndex.documentCount}`);
      return;
    }
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error('GEMINI_API_KEY 환경변수가 필요합니다. .env.example을 복사해 .env를 만들고 키를 설정하세요.');
  }

  const embeddingService = new GeminiEmbeddingService({
    apiKey: process.env.GEMINI_API_KEY,
    model,
    dimension,
    batchSize,
    requestDelayMs,
    quotaRetryDelayMs,
  });
  const checkpointDirectory = resolve(CHECKPOINT_ROOT, buildSignature.slice(0, 16));
  await mkdir(checkpointDirectory, { recursive: true });
  await writeJsonAtomically(resolve(checkpointDirectory, 'manifest.json'), {
    version: 1,
    buildSignature,
    knowledgeHash,
    model,
    dimension,
    batchSize,
    documentCount: documents.length,
    knowledgePath: 'server/rag/knowledge/scl-tests.json',
  });

  const vectors = [];
  const totalBatches = Math.ceil(documents.length / batchSize);
  let reusedBatches = 0;

  for (let start = 0, batchNumber = 1; start < documents.length; start += batchSize, batchNumber += 1) {
    const batch = preparedDocuments.slice(start, start + batchSize);
    const checkpointPath = resolve(checkpointDirectory, `batch-${String(batchNumber).padStart(4, '0')}.json`);
    const checkpoint = await readJsonIfPresent(checkpointPath);

    if (checkpointIsReusable(checkpoint, batch, buildSignature, dimension)) {
      vectors.push(...batch.map((document, index) => (
        vectorEntry(document, document.contentHash, checkpoint.vectors[index].values)
      )));
      reusedBatches += 1;
      console.log(`[${batchNumber}/${totalBatches}] checkpoint reused (${vectors.length}/${documents.length})`);
      continue;
    }

    const embeddings = await embeddingService.embedDocuments(batch.map((document) => ({
      title: document.title,
      text: document.content,
    })));
    const batchVectors = batch.map((document, index) => vectorEntry(document, document.contentHash, embeddings[index]));
    await writeJsonAtomically(checkpointPath, {
      buildSignature,
      batchNumber,
      start,
      vectors: batchVectors,
    });
    vectors.push(...batchVectors);
    console.log(`[${batchNumber}/${totalBatches}] embedded (${vectors.length}/${documents.length})`);

    if (requestDelayMs > 0 && batchNumber < totalBatches) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, requestDelayMs));
    }
  }

  const index = {
    version: 1,
    generatedAt: new Date().toISOString(),
    buildSignature,
    knowledgeHash,
    knowledgePath: 'server/rag/knowledge/scl-tests.json',
    model,
    dimension,
    normalized: true,
    similarityMetric: 'cosine',
    documentCount: vectors.length,
    vectors,
  };
  const validation = validateVectorIndex(index, { expectedDocumentIds: expectedIds });
  if (!validation.valid) throw new Error(`생성된 vector index 검증 실패: ${validation.errors[0]}`);
  await writeJsonAtomically(INDEX_PATH, index);

  console.log('Gemini vector index build completed');
  console.log(`Documents: ${vectors.length}`);
  console.log(`Model: ${model}`);
  console.log(`Dimension: ${dimension}`);
  console.log(`Reused batches: ${reusedBatches}/${totalBatches}`);
  console.log(`Output: ${INDEX_PATH}`);
}

main().catch((error) => {
  console.error(`Vector index build failed: ${error.message}`);
  process.exitCode = 1;
});
