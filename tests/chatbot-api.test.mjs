import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createChatbotServer,
  createRuntimeServices,
  ServiceUnavailableError,
} from '../server/chatbotServer.js';

const officialSource = 'https://www.scllab.co.kr/front/check/check_item_detail.do?itemcode=10130&sampcode=100';
const validResponse = {
  answer: 'ALT 검체는 Serum입니다.',
  grounded: true,
  matchedTests: [{
    id: 'knowledge-test-10130',
    testCode: '10130',
    testName: 'ALT',
    specimen: 'Serum',
    method: 'Enzymatic method',
    schedule: '월,화,수,목,금,토',
    timeType: '야간',
    turnaroundTime: '1일',
  }],
  sources: [{ id: 'knowledge-test-10130', title: 'ALT 검사정보', url: officialSource }],
  resources: [],
};

let server;
let baseUrl;

test.before(async () => {
  const answerService = {
    async answer(question) {
      if (question === '서비스 오류') throw new ServiceUnavailableError();
      if (question === '위조 링크') {
        return {
          ...validResponse,
          sources: [{ id: 'fake', title: '위조', url: 'https://example.com/fake' }],
        };
      }
      return validResponse;
    },
  };
  server = createChatbotServer({
    answerService,
    serviceStatus: {
      generationAvailable: false,
      semanticSearchAvailable: false,
      vectorIndexAvailable: false,
      knowledgeDocuments: 3327,
    },
    bodyLimitBytes: 128,
    logger: { error() {} },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/health는 키 없는 degraded 상태와 문서 수를 반환한다', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.status, 'degraded');
  assert.equal(payload.services.knowledgeDocuments, 3327);
  assert.equal(typeof response.headers.get('x-request-id'), 'string');
});

test('POST /api/chatbot/interpret는 구조화된 챗봇 응답을 반환한다', async () => {
  const response = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ question: 'ALT 검체는?' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(payload.answer, validResponse.answer);
  assert.equal(payload.sources[0].url, officialSource);
});

test('빈 question과 잘못된 JSON을 400으로 거부한다', async () => {
  const emptyResponse = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '   ' }),
  });
  assert.equal(emptyResponse.status, 400);
  assert.equal((await emptyResponse.json()).error.code, 'INVALID_QUESTION');

  const invalidJsonResponse = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(invalidJsonResponse.status, 400);
  assert.equal((await invalidJsonResponse.json()).error.code, 'INVALID_JSON');
});

test('지원하지 않는 Content-Type과 큰 본문을 거부한다', async () => {
  const contentTypeResponse = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'ALT',
  });
  assert.equal(contentTypeResponse.status, 415);

  const largeResponse = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'A'.repeat(200) }),
  });
  assert.equal(largeResponse.status, 413);
  assert.equal((await largeResponse.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

test('허용되지 않은 Origin과 HTTP method를 거부한다', async () => {
  const originResponse = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
    body: JSON.stringify({ question: 'ALT' }),
  });
  assert.equal(originResponse.status, 403);
  assert.equal((await originResponse.json()).error.code, 'ORIGIN_NOT_ALLOWED');

  const methodResponse = await fetch(`${baseUrl}/api/chatbot/interpret`);
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'POST');
});

test('답변 서비스 unavailable 오류를 503 구조로 반환한다', async () => {
  const response = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '서비스 오류' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 503);
  assert.equal(payload.error.code, 'GENERATION_UNAVAILABLE');
  assert.equal(typeof payload.error.requestId, 'string');
});

test('공식 SCL이 아닌 출력 URL은 API 경계에서 다시 거부한다', async () => {
  const response = await fetch(`${baseUrl}/api/chatbot/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: '위조 링크' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 500);
  assert.equal(payload.error.code, 'INTERNAL_ERROR');
  assert.equal(payload.error.message, '챗봇 답변을 처리하는 중 오류가 발생했습니다.');
});

test('실제 키 없는 런타임도 범위 밖 질문과 정확한 검사코드 질문을 결정적으로 처리한다', async () => {
  const runtime = await createRuntimeServices({
    apiKey: '',
    vectorIndexPath: 'Z:\\definitely-missing\\vector-index.json',
  });
  assert.equal(runtime.serviceStatus.generationAvailable, false);
  assert.equal(runtime.serviceStatus.knowledgeDocuments, 3327);

  const outOfScope = await runtime.answerService.answer('오늘 날씨 알려줘');
  assert.equal(outOfScope.grounded, false);
  assert.match(outOfScope.answer, /일상적인 대화에는 답변할 수 없습니다/);
  const exactCode = await runtime.answerService.answer('10130 검사 알려줘');
  assert.equal(exactCode.grounded, true);
  assert.equal(exactCode.matchedTests[0].testCode, '10130');
  assert.match(exactCode.answer, /ALT 검사/);
  assert.equal(exactCode.matchedTests[0].specimen, 'Serum');
});
