import assert from 'node:assert/strict';
import test from 'node:test';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test('질의는 RETRIEVAL_QUERY와 지정 차원으로 임베딩하고 정규화한다', async () => {
  let captured;
  const service = new GeminiEmbeddingService({
    apiKey: 'test-key',
    dimension: 2,
    maxRetries: 0,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ embedding: { values: [3, 4] } });
    },
  });

  const vector = await service.embedQuery('ALT 검사');
  assert.deepEqual(vector, [0.6, 0.8]);
  assert.match(captured.url, /models\/gemini-embedding-001:embedContent$/);
  assert.equal(captured.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(captured.body.taskType, 'RETRIEVAL_QUERY');
  assert.equal(captured.body.outputDimensionality, 2);
  assert.equal(captured.body.embedContentConfig, undefined);
});

test('문서 배치는 RETRIEVAL_DOCUMENT와 문서 제목을 전달한다', async () => {
  let capturedBody;
  const service = new GeminiEmbeddingService({
    apiKey: 'test-key',
    dimension: 2,
    batchSize: 2,
    maxRetries: 0,
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return jsonResponse({ embeddings: [{ values: [1, 0] }, { values: [0, 2] }] });
    },
  });

  const vectors = await service.embedDocuments([
    { title: 'ALT 검사', text: '검사코드: 10130' },
    { title: 'AST 검사', text: '검사코드: 10120' },
  ]);
  assert.deepEqual(vectors, [[1, 0], [0, 1]]);
  assert.equal(capturedBody.requests.length, 2);
  assert.equal(capturedBody.requests[0].taskType, 'RETRIEVAL_DOCUMENT');
  assert.equal(capturedBody.requests[0].title, 'ALT 검사');
  assert.equal(capturedBody.requests[0].outputDimensionality, 2);
  assert.equal(capturedBody.requests[0].embedContentConfig, undefined);
});

test('인증 오류는 재시도하지 않고 API 메시지를 보존한다', async () => {
  let calls = 0;
  const service = new GeminiEmbeddingService({
    apiKey: 'invalid-key',
    dimension: 2,
    maxRetries: 3,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ error: { message: 'API key not valid' } }, { ok: false, status: 401 });
    },
  });

  await assert.rejects(() => service.embedQuery('ALT'), /API key not valid/);
  assert.equal(calls, 1);
});

test('잘못된 응답 벡터 차원을 거부한다', async () => {
  const service = new GeminiEmbeddingService({
    apiKey: 'test-key',
    dimension: 3,
    maxRetries: 0,
    fetchImpl: async () => jsonResponse({ embedding: { values: [1, 0] } }),
  });

  await assert.rejects(() => service.embedQuery('ALT'), /차원이 올바르지 않습니다/);
});

test('429 할당량 제한은 서버 지시와 설정 중 긴 대기시간을 적용해 재시도한다', async () => {
  let calls = 0;
  const delays = [];
  const service = new GeminiEmbeddingService({
    apiKey: 'test-key',
    dimension: 2,
    maxRetries: 1,
    quotaRetryDelayMs: 5000,
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
    logger: { warn() {} },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          error: {
            message: 'quota exceeded',
            details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
          },
        }, { ok: false, status: 429 });
      }
      return jsonResponse({ embedding: { values: [1, 0] } });
    },
  });

  assert.deepEqual(await service.embedQuery('ALT'), [1, 0]);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [12000]);
});
