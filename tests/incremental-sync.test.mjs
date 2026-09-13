import assert from 'node:assert/strict';
import test from 'node:test';
import { insuranceCodeAliases, normalizeInsuranceCode, toQdrantPayload } from '../server/rag/contentIdentity.js';
import { syncDocuments } from '../server/sync/incrementalSync.js';

function document(id, turnaroundTime = '5일', sourceUrl = `https://www.scllab.co.kr/${id}`) {
  return {
    id, testCode: id.slice(-5), sampleCode: '100', testName: `검사 ${id}`, specimen: 'Serum', method: 'LC-MS/MS',
    insuranceCode: '-', schedule: '월~토', timeType: '주간', turnaroundTime,
    content: `검사명: 검사 ${id}\n검사 소요일: ${turnaroundTime}`, keywords: [], sourceUrl,
    pdfUrls: [], imageUrls: [], resources: [], metadata: {},
  };
}

function fakeStore(existingDocuments) {
  const calls = { upserts: [], payloads: [], deactivated: [] };
  const points = existingDocuments.map((item, index) => ({ id: `point-${index}`, vector: [1, 0], payload: toQdrantPayload(item, { now: '2026-01-01T00:00:00.000Z' }) }));
  return {
    dimension: 2,
    ensureCollection: async () => {},
    listAll: async () => points,
    upsert: async (values) => calls.upserts.push(...values),
    updatePayload: async (pointId, payload) => calls.payloads.push({ pointId, payload }),
    updatePayloadBatch: async (items) => calls.payloads.push(...items),
    deactivate: async (ids) => calls.deactivated.push(...ids),
    calls,
  };
}

test('소요일 한 건 변경 시 해당 문서만 재임베딩한다', async () => {
  const first = document('test-16290');
  const second = document('test-11380', '30일');
  const store = fakeStore([first, second]);
  const embedded = [];
  const report = await syncDocuments({
    documents: [{ ...first, turnaroundTime: '3일', content: '검사명: 검사 test-16290\n검사 소요일: 3일' }, second],
    store,
    embeddingService: { batchSize: 20, embedDocuments: async (items) => { embedded.push(...items); return items.map(() => [0, 1]); } },
  });
  assert.equal(report.scanned, 2);
  assert.equal(report.updated, 1);
  assert.equal(report.unchanged, 1);
  assert.equal(report.embeddingCalls, 1);
  assert.equal(report.embeddedDocuments, 1);
  assert.equal(embedded.length, 1);
  assert.equal(store.calls.upserts.length, 1);
});

test('metadata만 변경하면 vector를 재생성하지 않고 payload만 갱신한다', async () => {
  const first = document('test-16290');
  const store = fakeStore([first]);
  const report = await syncDocuments({
    documents: [document('test-16290', '5일', 'https://www.scllab.co.kr/changed')],
    store,
    embeddingService: { embedDocuments: async () => { throw new Error('호출되면 안 됩니다.'); } },
  });
  assert.equal(report.embeddingCalls, 0);
  assert.equal(store.calls.upserts.length, 0);
  assert.equal(store.calls.payloads.length, 1);
});

test('급여·비급여 코드를 Qdrant keyword 검색용 값으로 정규화한다', () => {
  assert.equal(normalizeInsuranceCode('d470002hzetc.'), 'D470002HZETC');
  assert.deepEqual(insuranceCodeAliases('D470002HZetc.'), ['D470002HZETC', 'D470002HZ']);
  assert.deepEqual(insuranceCodeAliases('-'), []);

  const payload = toQdrantPayload({ ...document('test-10135'), insuranceCode: 'D185000HZ' });
  assert.deepEqual(payload.normalizedInsuranceCodes, ['D185000HZ']);
});

test('크롤 실패가 있으면 사라진 데이터를 비활성화하지 않는다', async () => {
  const store = fakeStore([document('test-16290'), document('test-11380')]);
  const report = await syncDocuments({ documents: [document('test-16290')], store, failures: 1 });
  assert.equal(report.deactivated, 0);
  assert.equal(store.calls.deactivated.length, 0);
});
