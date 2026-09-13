import { embeddingDocument, qdrantPointId, toQdrantPayload } from '../rag/contentIdentity.js';

function vectorValues(point) {
  if (Array.isArray(point.vector)) return point.vector;
  if (point.vector && typeof point.vector === 'object') return Object.values(point.vector)[0];
  return null;
}

export async function syncDocuments({
  documents,
  store,
  embeddingService,
  legacyVectors = new Map(),
  failures = 0,
  minimumDeactivationCoverage = 0.8,
  now = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(documents)) throw new Error('동기화할 documents 배열이 필요합니다.');
  if (!store?.ensureCollection || !store?.listAll || !store?.upsert) throw new Error('Qdrant store가 필요합니다.');
  await store.ensureCollection();
  const existingPoints = await store.listAll({ withVector: true });
  const existingByDocumentId = new Map(existingPoints
    .filter((point) => point.payload?.id)
    .map((point) => [point.payload.id, point]));
  const seenIds = new Set();
  const createQueue = [];
  const reembedQueue = [];
  const payloadQueue = [];
  let unchanged = 0;

  for (const document of documents) {
    const payload = toQdrantPayload(document, { now, active: true });
    seenIds.add(payload.id);
    const existing = existingByDocumentId.get(payload.id);
    if (!existing) {
      createQueue.push({ document, payload, legacyVector: legacyVectors.get(payload.id) ?? null });
    } else if (existing.payload.contentHash !== payload.contentHash) {
      reembedQueue.push({ document, payload });
    } else if (existing.payload.payloadHash !== payload.payloadHash || existing.payload.active !== true) {
      payloadQueue.push({ pointId: existing.id, payload });
    } else {
      unchanged += 1;
    }
  }

  const report = {
    scanned: documents.length,
    created: createQueue.length,
    updated: reembedQueue.length + payloadQueue.length,
    unchanged,
    deactivated: 0,
    embeddingCalls: 0,
    embeddedDocuments: 0,
    failures: Number(failures) || 0,
  };

  const pointsToUpsert = [];
  for (const item of createQueue) {
    if (Array.isArray(item.legacyVector) && item.legacyVector.length === store.dimension) {
      pointsToUpsert.push({ id: qdrantPointId(item.payload.id), vector: item.legacyVector, payload: item.payload });
    } else {
      reembedQueue.push(item);
    }
  }

  const batchSize = Math.max(1, Number(embeddingService?.batchSize ?? 20));
  for (let offset = 0; offset < reembedQueue.length; offset += batchSize) {
    if (!embeddingService?.embedDocuments) throw new Error('신규·변경 데이터 임베딩에 Gemini Embedding 설정이 필요합니다.');
    const batch = reembedQueue.slice(offset, offset + batchSize);
    const vectors = await embeddingService.embedDocuments(batch.map((item) => embeddingDocument(item.payload)));
    report.embeddingCalls += 1;
    report.embeddedDocuments += batch.length;
    for (let index = 0; index < batch.length; index += 1) {
      const existing = existingByDocumentId.get(batch[index].payload.id);
      pointsToUpsert.push({
        id: existing?.id ?? qdrantPointId(batch[index].payload.id),
        vector: vectors[index],
        payload: batch[index].payload,
      });
    }
  }

  for (let offset = 0; offset < pointsToUpsert.length; offset += 100) {
    await store.upsert(pointsToUpsert.slice(offset, offset + 100));
  }
  for (let offset = 0; offset < payloadQueue.length; offset += 100) {
    const batch = payloadQueue.slice(offset, offset + 100);
    if (store.updatePayloadBatch) await store.updatePayloadBatch(batch);
    else for (const item of batch) await store.updatePayload(item.pointId, item.payload);
  }

  const activeExisting = existingPoints.filter((point) => point.payload?.active !== false);
  const missingPointIds = activeExisting.filter((point) => !seenIds.has(point.payload?.id)).map((point) => point.id);
  const sufficientCoverage = activeExisting.length === 0 || documents.length >= activeExisting.length * minimumDeactivationCoverage;
  if (failures === 0 && sufficientCoverage && missingPointIds.length > 0) {
    await store.deactivate(missingPointIds, now);
    report.deactivated = missingPointIds.length;
  }
  return report;
}

export function legacyVectorMap(vectorIndex) {
  return new Map((vectorIndex?.vectors ?? []).map((entry) => [entry.id, entry.values]));
}
