import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeQuery, extractInsuranceCodes, extractTestNameCandidates, INTENTS } from '../server/rag/queryAnalyzer.js';
import { evaluateSafety } from '../server/rag/safetyGate.js';

test('검사코드, intent, 자연어 field alias를 분석한다', () => {
  const analysis = analyzeQuery('16290 검사 며칠 걸려?');
  assert.deepEqual(analysis.entity.testCodes, ['16290']);
  assert.equal(analysis.intent, INTENTS.FIELD_LOOKUP);
  assert.equal(analysis.field, 'turnaroundTime');
});

test('복수 검사 비교와 의미 검색을 구분한다', () => {
  const comparison = analyzeQuery('16290이랑 11380 중 어떤 검사가 더 빨라?');
  assert.deepEqual(comparison.entity.testCodes, ['16290', '11380']);
  assert.equal(comparison.intent, INTENTS.COMPARISON);
  const semantic = analyzeQuery('파브리병 관련 검사 뭐 있어?');
  assert.equal(semantic.entity.testCodes.length, 0);
  assert.equal(semantic.intent, INTENTS.SEARCH);
});

test('개인 결과 해석과 약물 질문을 retrieval 전에 식별한다', () => {
  assert.equal(evaluateSafety('이 검사 결과면 무슨 병이에요?').blocked, true);
  assert.equal(evaluateSafety('ALT 높으면 무슨 병이에요?').blocked, true);
  assert.equal(evaluateSafety('어떤 약 먹어야 하나요?').blocked, true);
  assert.equal(evaluateSafety('16290 결과 언제 나와?').blocked, false);
});

test('검사명이 문장 어느 위치에 있어도 exact 검증 후보로 보존한다', () => {
  const questions = [
    'ALT 검사는 어떤 검체를 사용하나요?',
    '검체는 ALT 검사에서 뭘 사용해?',
    '소요일이 궁금한 검사는 ALT야',
    'ALT에 대해서 검체만 확인해줘',
  ];
  for (const question of questions) {
    const analysis = analyzeQuery(question);
    assert.ok(analysis.entity.testNameCandidates.some((candidate) => candidate.toLocaleLowerCase('ko-KR') === 'alt'));
  }
});

test('부분 문자열을 짧은 검사명으로 만들지 않고 복수 영문 검사명을 각각 보존한다', () => {
  assert.ok(!extractTestNameCandidates('Cobalt와 MALToma 검사').some((candidate) => candidate.toLocaleLowerCase('ko-KR') === 'alt'));
  const comparison = analyzeQuery('ALT와 AST 중 어떤 검사가 더 빨라?');
  const normalizedCandidates = comparison.entity.testNameCandidates.map((candidate) => candidate.toLocaleLowerCase('ko-KR'));
  assert.ok(normalizedCandidates.includes('alt'));
  assert.ok(normalizedCandidates.includes('ast'));
  assert.equal(comparison.intent, INTENTS.COMPARISON);
});

test('급여·비급여 코드를 검사코드와 분리해 대소문자와 조사에 관계없이 추출한다', () => {
  const analysis = analyzeQuery('급여코드 d185000hz로 검사 찾아줘');
  assert.deepEqual(analysis.entity.insuranceCodes, ['D185000HZ']);
  assert.deepEqual(analysis.entity.testCodes, []);
  assert.equal(analysis.field, 'insuranceCode');
  assert.deepEqual(extractInsuranceCodes('D470002HZetc.와 CX56800KZ 검사'), ['D470002HZETC', 'CX56800KZ']);

  const sclCode = analyzeQuery('검사코드 16290 알려줘');
  assert.deepEqual(sclCode.entity.insuranceCodes, []);
  assert.deepEqual(sclCode.entity.testCodes, ['16290']);
});
