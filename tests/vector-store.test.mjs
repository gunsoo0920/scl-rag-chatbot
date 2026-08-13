import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, searchVectorIndex, validateVectorIndex } from '../server/rag/vectorStore.js';

function sampleIndex() {
  return {
    version: 1,
    model: 'gemini-embedding-001',
    dimension: 2,
    normalized: true,
    documentCount: 3,
    vectors: [
      { id: 'alt', title: 'ALT 검사', values: [1, 0] },
      { id: 'ast', title: 'AST 검사', values: [0.8, 0.6] },
      { id: 'unrelated', title: '다른 검사', values: [0, 1] },
    ],
  };
}

test('cosine similarity가 동일 방향과 직교 벡터를 구분한다', () => {
  assert.equal(cosineSimilarity([2, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('검색은 similarity threshold와 topK를 적용한다', () => {
  const results = searchVectorIndex(sampleIndex(), [1, 0], { topK: 1, minSimilarity: 0.7 });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'alt');
  assert.equal(results[0].similarity, 1);
});

test('threshold 미만 결과는 반환하지 않는다', () => {
  const results = searchVectorIndex(sampleIndex(), [0, -1], { topK: 5, minSimilarity: 0.1 });
  assert.deepEqual(results, []);
});

test('질의 벡터 차원이 다르면 거부한다', () => {
  assert.throws(() => searchVectorIndex(sampleIndex(), [1, 0, 0]), /질의 벡터 차원/);
});

test('인덱스 검증은 중복 ID와 비정규화 벡터를 찾는다', () => {
  const index = sampleIndex();
  index.vectors[1] = { id: 'alt', values: [2, 0] };
  const validation = validateVectorIndex(index);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('중복 vector id')));
  assert.ok(validation.errors.some((error) => error.includes('정규화 오류')));
});
