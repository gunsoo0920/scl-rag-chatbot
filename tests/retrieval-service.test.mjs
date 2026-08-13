import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RetrievalService } from '../server/rag/retrievalService.js';

const documents = JSON.parse(await readFile(new URL('../server/rag/knowledge/scl-tests.json', import.meta.url), 'utf8'));

test('실제 데이터에서 검사코드 exact match를 최우선으로 찾는다', async () => {
  const service = new RetrievalService({ documents });
  const [result] = await service.search('10130 검사 정보 알려줘');
  assert.equal(result.testCode, '10130');
  assert.equal(result.testName, 'ALT');
  assert.ok(result.retrieval.matchReasons.includes('test-code-exact'));
});

test('ALT 이름 검색이 Cobalt나 MALToma의 부분 문자열과 혼동되지 않는다', async () => {
  const service = new RetrievalService({ documents, topK: 10 });
  const results = await service.search('ALT 검사 결과는 며칠 걸려?');
  assert.equal(results[0].testName, 'ALT');
  assert.equal(results.some((result) => /cobalt|maltoma/i.test(result.testName)), false);
});

test('공식 검사명의 exact phrase를 우선한다', async () => {
  const service = new RetrievalService({ documents });
  const [result] = await service.search('(특검)ALT 알려줘');
  assert.equal(result.testName, '(특검)ALT');
  assert.ok(result.retrieval.matchReasons.includes('test-name-phrase'));
});

test('벡터 결과는 similarity threshold를 적용해 lexical 결과와 결합한다', async () => {
  const sampleDocuments = [
    { id: 'alt', testCode: '10130', testName: 'ALT', keywords: ['ALT'] },
    { id: 'ast', testCode: '10120', testName: 'AST', keywords: ['AST'] },
  ];
  const vectorIndex = {
    version: 1,
    model: 'gemini-embedding-001',
    dimension: 2,
    normalized: true,
    documentCount: 2,
    vectors: [
      { id: 'alt', values: [1, 0] },
      { id: 'ast', values: [0, 1] },
    ],
  };
  const embeddingService = { embedQuery: async () => [0.9, Math.sqrt(0.19)] };
  const service = new RetrievalService({
    documents: sampleDocuments,
    vectorIndex,
    embeddingService,
    minSimilarity: 0.8,
  });

  const results = await service.search('간 효소 관련 항목', { topK: 5 });
  assert.deepEqual(results.map((result) => result.id), ['alt']);
  assert.ok(results[0].retrieval.similarity >= 0.8);
});

test('검사코드 exact match는 상충하는 semantic 점수보다 우선한다', async () => {
  const sampleDocuments = [
    { id: 'alt', testCode: '10130', testName: 'ALT', keywords: ['ALT'] },
    { id: 'ast', testCode: '10120', testName: 'AST', keywords: ['AST'] },
  ];
  const vectorIndex = {
    version: 1,
    model: 'gemini-embedding-001',
    dimension: 2,
    normalized: true,
    documentCount: 2,
    vectors: [
      { id: 'alt', values: [1, 0] },
      { id: 'ast', values: [0, 1] },
    ],
  };
  let embeddingCalls = 0;
  const service = new RetrievalService({
    documents: sampleDocuments,
    vectorIndex,
    embeddingService: { embedQuery: async () => {
      embeddingCalls += 1;
      return [0, 1];
    } },
    minSimilarity: 0,
  });

  const [result] = await service.search('10130 검사 알려줘');
  assert.equal(result.id, 'alt');
  assert.equal(result.retrieval.lexicalScore >= 1000, true);
  assert.equal(embeddingCalls, 0);
});

test('공식 검사명이 명확히 일치하면 불필요한 semantic embedding을 생략한다', async () => {
  const sampleDocuments = [
    { id: 'alt', testCode: '10130', testName: 'ALT', keywords: ['ALT'] },
    { id: 'ast', testCode: '10120', testName: 'AST', keywords: ['AST'] },
  ];
  const vectorIndex = {
    version: 1,
    model: 'gemini-embedding-001',
    dimension: 2,
    normalized: true,
    documentCount: 2,
    vectors: [
      { id: 'alt', values: [1, 0] },
      { id: 'ast', values: [0, 1] },
    ],
  };
  let embeddingCalls = 0;
  const service = new RetrievalService({
    documents: sampleDocuments,
    vectorIndex,
    embeddingService: { embedQuery: async () => {
      embeddingCalls += 1;
      return [0, 1];
    } },
    minSimilarity: 0,
  });

  const [result] = await service.search('ALT 검사방법 알려줘');
  assert.equal(result.id, 'alt');
  assert.ok(result.retrieval.matchReasons.includes('test-name-phrase'));
  assert.equal(embeddingCalls, 0);
});

test('lexical 및 semantic 근거가 없는 질문은 결과를 반환하지 않는다', async () => {
  const service = new RetrievalService({ documents });
  const results = await service.search('오늘 날씨 알려줘');
  assert.deepEqual(results, []);
});
