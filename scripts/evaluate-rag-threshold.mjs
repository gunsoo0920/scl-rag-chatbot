import { loadEnvironment } from '../server/loadEnvironment.js';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';
import { loadRetrievalService } from '../server/rag/retrievalService.js';

const IN_SCOPE_QUERIES = [
  { query: 'ALT 검사는 어떤 검체를 사용하나요?', expectedCodes: ['10130', '10135'] },
  { query: '10130 검사 결과는 며칠 걸려?', expectedCodes: ['10130'] },
  { query: 'AST GOT 검사를 알려줘', expectedCodes: ['10120', '10125'] },
  { query: '당화혈색소 HbA1c 검사 정보', expectedCodes: ['P1260'] },
  { query: '갑상선 자극 호르몬 TSH 검사', expectedCodes: ['50040', '50042'] },
];

const OUT_OF_SCOPE_QUERIES = [
  '오늘 서울 날씨 알려줘',
  '강남 맛집 추천해줘',
  '자바스크립트 배열 정렬 방법',
];

loadEnvironment();
if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('GEMINI_API_KEY가 필요합니다.');

const embeddingService = new GeminiEmbeddingService();
const service = await loadRetrievalService({ embeddingService, minSimilarity: -1, topK: 5 });
if (!service.semanticAvailable) throw new Error('vector index를 찾을 수 없습니다.');

const targetSimilarities = [];
const outOfScopeMaximums = [];

for (const evaluation of IN_SCOPE_QUERIES) {
  const results = await service.search(evaluation.query, { topK: 5, minSimilarity: -1 });
  const target = results.find((result) => evaluation.expectedCodes.includes(result.testCode));
  console.log(`\n[IN] ${evaluation.query}`);
  for (const result of results) {
    console.log(`  ${result.testCode} | ${result.testName} | similarity=${result.retrieval.similarity?.toFixed(4) ?? 'n/a'}`);
  }
  if (!target || target.retrieval.similarity === null) {
    throw new Error(`기대 검사를 찾지 못했습니다: ${evaluation.query}`);
  }
  targetSimilarities.push(target.retrieval.similarity);
}

for (const query of OUT_OF_SCOPE_QUERIES) {
  const results = await service.search(query, { topK: 5, minSimilarity: -1 });
  const maximum = Math.max(...results.map((result) => result.retrieval.similarity ?? -1));
  console.log(`\n[OUT] ${query}`);
  for (const result of results) {
    console.log(`  ${result.testCode} | ${result.testName} | similarity=${result.retrieval.similarity?.toFixed(4) ?? 'n/a'}`);
  }
  outOfScopeMaximums.push(maximum);
}

const minimumTarget = Math.min(...targetSimilarities);
const maximumOutOfScope = Math.max(...outOfScopeMaximums);
console.log('\nSCL RAG similarity evaluation');
console.log(`Minimum expected-test similarity: ${minimumTarget.toFixed(4)}`);
console.log(`Maximum out-of-scope similarity: ${maximumOutOfScope.toFixed(4)}`);
if (minimumTarget > maximumOutOfScope) {
  const midpoint = (minimumTarget + maximumOutOfScope) / 2;
  console.log(`Separation margin: ${(minimumTarget - maximumOutOfScope).toFixed(4)}`);
  console.log(`Suggested threshold midpoint: ${midpoint.toFixed(4)}`);
} else {
  console.log('No clean separation: expand the evaluation set before choosing a threshold.');
}
