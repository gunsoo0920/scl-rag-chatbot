import assert from 'node:assert/strict';
import test from 'node:test';
import { IntentAwareAnswerService } from '../server/rag/intentAwareAnswerService.js';
import { QueryMetrics } from '../server/rag/queryMetrics.js';
import { RetrievalRouter } from '../server/rag/retrievalRouter.js';

const source = (code, sample) => `https://www.scllab.co.kr/front/check/check_item_detail.do?itemcode=${code}&sampcode=${sample}`;
function document({ code, sample = '100', name, specimen, turnaround }) {
  return {
    id: `knowledge-test-${code}-${sample}`, testCode: code, sampleCode: sample, testName: name,
    specimen, method: 'LC-MS/MS', insuranceCode: '-', schedule: '월~토', timeType: '주간', turnaroundTime: turnaround,
    content: `검사명: ${name}\nSCL 검사코드: ${code}\n검사방법: LC-MS/MS\n검체명: ${specimen}\n검사일: 월~토\n검사 구분: 주간\n검사 소요일: ${turnaround}`,
    keywords: [name], sourceUrl: source(code, sample), pdfUrls: [], imageUrls: [], resources: [], active: true,
  };
}

const fabry = document({ code: '16290', sample: '510', name: 'α-Galactosidase (GLA)_Fabry', specimen: 'Heparin W/B', turnaround: '5일' });
const microUrine = document({ code: '11380', sample: '400', name: 'α1-microglobulin (RU)', specimen: 'Urine,random', turnaround: '30일' });
const microSerum = document({ code: '11380', sample: '100', name: 'α1-microglobulin (S)', specimen: 'Serum', turnaround: '30일' });

function setup() {
  let embeddingCalls = 0;
  let generationCalls = 0;
  let storeCalls = 0;
  const documents = [fabry, microUrine, microSerum];
  const store = {
    findByTestCodes: async (codes) => {
      storeCalls += 1;
      return documents.filter((item) => codes.includes(item.testCode));
    },
    findByExactName: async (name) => {
      storeCalls += 1;
      return documents.filter((item) => item.testName.toLocaleLowerCase('ko-KR') === name.toLocaleLowerCase('ko-KR'));
    },
    semanticSearch: async () => {
      storeCalls += 1;
      return [fabry];
    },
  };
  const metrics = new QueryMetrics();
  const router = new RetrievalRouter({
    store,
    metrics,
    embeddingService: { embedQuery: async () => { embeddingCalls += 1; return [1, 0]; } },
    topK: 5,
    minScore: 0.6,
  });
  const service = new IntentAwareAnswerService({
    router,
    metrics,
    generationService: { generateGroundedAnswer: async () => { generationCalls += 1; throw new Error('호출되면 안 됩니다.'); } },
  });
  return { service, metrics, calls: () => ({ embeddingCalls, generationCalls, storeCalls }) };
}

test('exact와 structured 질문은 embedding과 generation을 모두 우회한다', async () => {
  const runtime = setup();
  const exact = await runtime.service.answer('16290 검사 알려줘');
  assert.equal(exact.retrievalPath, 'EXACT');
  assert.equal(exact.matchedTests[0].testCode, '16290');
  const structured = await runtime.service.answer('16290 검사 며칠 걸려?');
  assert.equal(structured.retrievalPath, 'STRUCTURED');
  assert.match(structured.answer, /5일/);
  assert.deepEqual(runtime.calls(), { embeddingCalls: 0, generationCalls: 0, storeCalls: 2 });
});

test('복수 코드 소요일은 프로그램이 직접 비교하고 검체 variant를 보존한다', async () => {
  const runtime = setup();
  const response = await runtime.service.answer('16290이랑 11380 중 어떤 검사가 더 빨라?');
  assert.equal(response.retrievalPath, 'COMPARISON');
  assert.match(response.answer, /16290.*11380보다 소요일이 짧습니다/);
  assert.equal(response.matchedTests.length, 3);
  assert.equal(runtime.calls().embeddingCalls, 0);
  assert.equal(runtime.calls().generationCalls, 0);
});

test('기준 없는 빠른 편 질문은 소요일 사실과 판단 불가를 분리한다', async () => {
  const runtime = setup();
  const response = await runtime.service.answer('16290 검사가 빨리 나오는 편이야?');
  assert.match(response.answer, /비교 기준이 없습니다/);
  assert.match(response.answer, /5일/);
});

test('semantic 검색만 query embedding과 Qdrant vector search를 사용한다', async () => {
  const runtime = setup();
  const response = await runtime.service.answer('파브리병 관련 검사 뭐 있어?');
  assert.equal(response.retrievalPath, 'VECTOR');
  assert.equal(runtime.calls().embeddingCalls, 1);
  assert.equal(runtime.calls().generationCalls, 0);
  assert.equal(runtime.metrics.snapshot().vectorQueries, 1);
});

test('의료 조언은 Qdrant와 AI 호출 전에 차단한다', async () => {
  const runtime = setup();
  const response = await runtime.service.answer('이 검사 결과면 무슨 병이에요?');
  assert.equal(response.retrievalPath, 'BLOCKED');
  assert.equal(runtime.calls().storeCalls, 0);
  assert.equal(runtime.calls().embeddingCalls, 0);
  assert.equal(runtime.calls().generationCalls, 0);
  assert.equal(runtime.metrics.snapshot().blockedMedicalQueries, 1);
});
