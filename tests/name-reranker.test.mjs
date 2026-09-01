import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ambiguousCategoryTerm,
  rerankSemanticDocuments,
  tokenSimilarity,
} from '../server/rag/nameReranker.js';
import { analyzeQuery } from '../server/rag/queryAnalyzer.js';
import { RetrievalRouter } from '../server/rag/retrievalRouter.js';

function candidate(testCode, testName, score) {
  return { testCode, testName, retrieval: { score, similarity: score, matchReasons: ['semantic'] } };
}

const altCandidates = [
  candidate('10135', '(특검)ALT', 0.6782),
  candidate('10130', 'ALT', 0.6593),
  candidate('10125', '(특검)AST', 0.6338),
  candidate('10120', 'AST', 0.6192),
  candidate('10165', '(특검)Alk.phosphatase', 0.6081),
  candidate('50600', 'Aldosterone (LC-MS/MS)', 0.6054),
];

test('ALT가 정확하면 AST 등 다른 영문 토큰 후보를 제거하고 오타가 가까운 ALT 한 건을 선택한다', () => {
  const results = rerankSemanticDocuments('ALT(특채)', altCandidates, { topK: 5 });
  assert.deepEqual(results.map((item) => item.testCode), ['10135']);
});

test('검색 문장이 붙어도 핵심 검사명과 가까운 한 건을 선택한다', () => {
  const results = rerankSemanticDocuments('ALT(특채)라고 검색했는데', altCandidates, { topK: 5 });
  assert.deepEqual(results.map((item) => item.testCode), ['10135']);
});

test('핵심 영문 토큰 자체에 오타가 있어도 가까운 검사명을 찾고 AST는 제외한다', () => {
  const results = rerankSemanticDocuments('ALTT 검사', altCandidates, { topK: 5 });
  assert.deepEqual(results.map((item) => item.testCode), ['10135']);
  assert.equal(results.some((item) => /AST/iu.test(item.testName)), false);
});

test('목록 요청이 아닌 한글 직접 검색은 vector 1위 한 건만 표시한다', () => {
  const results = rerankSemanticDocuments('알부민 특채', altCandidates, { topK: 5 });
  assert.deepEqual(results, altCandidates.slice(0, 1));
});

test('핵심 영문 토큰이 없는 질환 중심 질문은 기존 vector 순위를 유지한다', () => {
  const results = rerankSemanticDocuments('파브리병 관련 검사', altCandidates, { topK: 3 });
  assert.deepEqual(results, altCandidates.slice(0, 3));
});

test('영문 질환명의 관련 검사 질문도 이름 토큰으로 과도하게 제한하지 않는다', () => {
  const results = rerankSemanticDocuments('Fabry 관련 검사', altCandidates, { topK: 3 });
  assert.deepEqual(results, altCandidates.slice(0, 3));
});

test('짧은 영문 검사명의 한 글자 차이는 구분한다', () => {
  assert.equal(tokenSimilarity('alt', 'alt'), 1);
  assert.ok(tokenSimilarity('alt', 'ast') < 0.75);
  assert.ok(tokenSimilarity('altt', 'alt') >= 0.75);
});

test('범주어 하나가 여러 검사명에 반복되면 구체화를 요청한다', () => {
  const candidates = [
    candidate('10135', '(특검)ALT', 0.58),
    candidate('10125', '(특검)AST', 0.57),
    candidate('50042', '(특검)TSH', 0.55),
  ];
  assert.equal(ambiguousCategoryTerm('특검 검사', candidates), '특검');
  assert.equal(ambiguousCategoryTerm('특검 검사 목록', candidates), null);
});

test('ALT 외 PCR, 유전자, 코로나 범주 질문도 여러 후보를 감지한다', () => {
  assert.equal(ambiguousCategoryTerm('PCR 검사', [
    candidate('A', '바이러스성 뇌수막염 PCR', 0.58),
    candidate('B', '세균성 뇌수막염 PCR', 0.57),
  ]), 'pcr');
  assert.equal(ambiguousCategoryTerm('유전자 검사', [
    candidate('C', '가족유전자검사', 0.58),
    candidate('D', '골격이형성 증후군 유전자 패널검사', 0.57),
  ]), '유전자');
  assert.equal(ambiguousCategoryTerm('코로나 검사', [
    candidate('E', '코로나(COVID-19) PCR', 0.58),
    candidate('F', '코로나바이러스감염증-19 PCR', 0.57),
  ]), '코로나');
});

test('ALT 특채처럼 여러 단어로 특정한 오타 질문은 범주 질문으로 처리하지 않는다', () => {
  assert.equal(ambiguousCategoryTerm('ALT(특채)', altCandidates), null);
});

test('ALT 특채는 고정 별칭이 아니라 vector 후보의 이름 재정렬로 한 건을 선택한다', async () => {
  let embeddingCalls = 0;
  let requestedTopK = 0;
  const router = new RetrievalRouter({
    store: {
      findByExactNames: async () => [],
      semanticSearch: async (_vector, options) => {
        requestedTopK = options.topK;
        return altCandidates;
      },
    },
    embeddingService: {
      embedQuery: async () => {
        embeddingCalls += 1;
        return [1, 0];
      },
    },
    topK: 5,
    minScore: 0.6,
  });

  const result = await router.retrieve(analyzeQuery('ALT(특채)'));
  assert.equal(result.path, 'VECTOR');
  assert.deepEqual(result.documents.map((item) => item.testCode), ['10135']);
  assert.equal(embeddingCalls, 1);
  assert.equal(requestedTopK, 5);
});

test('특검 검사는 낮은 vector 점수여도 여러 범주 후보를 확인하고 clarification으로 전환한다', async () => {
  const candidates = [
    candidate('10135', '(특검)ALT', 0.58),
    candidate('10125', '(특검)AST', 0.57),
    candidate('50042', '(특검)TSH', 0.55),
  ];
  let requestedMinScore = null;
  const router = new RetrievalRouter({
    store: {
      findByExactNames: async () => [],
      semanticSearch: async (_vector, options) => {
        requestedMinScore = options.minScore;
        return candidates;
      },
    },
    embeddingService: { embedQuery: async () => [1, 0] },
    topK: 5,
    minScore: 0.6,
  });

  const result = await router.retrieve(analyzeQuery('특검 검사'));
  assert.equal(result.path, 'CLARIFICATION');
  assert.equal(result.clarification.term, '특검');
  assert.equal(requestedMinScore, 0);
});
