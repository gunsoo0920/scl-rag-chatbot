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
const alt = document({ code: '10130', sample: '100', name: 'ALT', specimen: 'Serum', turnaround: '1일' });
const ast = document({ code: '10120', sample: '100', name: 'AST', specimen: 'Serum', turnaround: '2일' });

function setup() {
  let embeddingCalls = 0;
  let generationCalls = 0;
  let storeCalls = 0;
  const documents = [fabry, microUrine, microSerum, alt, ast];
  const store = {
    findByTestCodes: async (codes) => {
      storeCalls += 1;
      return documents.filter((item) => codes.includes(item.testCode));
    },
    findByExactName: async (name) => {
      storeCalls += 1;
      return documents.filter((item) => item.testName.toLocaleLowerCase('ko-KR') === name.toLocaleLowerCase('ko-KR'));
    },
    findByExactNames: async (names) => {
      storeCalls += 1;
      const normalizedNames = new Set(names.map((name) => name.toLocaleLowerCase('ko-KR')));
      return documents.filter((item) => normalizedNames.has(item.testName.toLocaleLowerCase('ko-KR')));
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
  assert.equal(structured.presentation, 'RESULTS_ONLY');
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
  assert.equal(response.presentation, 'RESULTS_ONLY');
  assert.doesNotMatch(response.answer, /\d+건을 찾았습니다/);
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

test('다양한 어순의 ALT field 질문은 batch exact 조회로 처리한다', async () => {
  const runtime = setup();
  const questions = [
    'ALT 검사는 어떤 검체를 사용하나요?',
    '검체는 ALT 검사에서 뭘 사용해?',
    '소요일이 궁금한 검사는 ALT야',
    'ALT에 대해서 검체만 확인해줘',
  ];
  for (const question of questions) {
    const response = await runtime.service.answer(question);
    assert.equal(response.retrievalPath, 'STRUCTURED');
    assert.deepEqual(response.matchedTests.map((item) => item.testCode), ['10130']);
  }
  assert.equal(runtime.calls().embeddingCalls, 0);
  assert.equal(runtime.calls().generationCalls, 0);
  assert.equal(runtime.calls().storeCalls, questions.length);
});

test('검사코드가 없는 복수 검사명 비교도 두 exact 결과를 보존한다', async () => {
  const runtime = setup();
  const response = await runtime.service.answer('ALT와 AST 중 어떤 검사가 더 빨라?');
  assert.equal(response.retrievalPath, 'COMPARISON');
  assert.deepEqual(new Set(response.matchedTests.map((item) => item.testCode)), new Set(['10130', '10120']));
  assert.match(response.answer, /10130.*10120보다 소요일이 짧습니다/);
  assert.equal(runtime.calls().embeddingCalls, 0);
  assert.equal(runtime.calls().generationCalls, 0);
});

test('여러 범주 후보가 있는 질문은 검사 결과 대신 구체화를 요청한다', async () => {
  const metrics = new QueryMetrics();
  const service = new IntentAwareAnswerService({
    router: {
      retrieve: async () => ({
        path: 'CLARIFICATION',
        documents: [],
        clarification: { term: '특검' },
      }),
    },
    metrics,
  });

  const response = await service.answer('특검 검사');
  assert.equal(response.retrievalPath, 'CLARIFICATION');
  assert.equal(response.grounded, false);
  assert.deepEqual(response.matchedTests, []);
  assert.match(response.answer, /여러 개.*검사명.*검사코드/);
  assert.equal(metrics.snapshot().clarificationQueries, 1);
});
