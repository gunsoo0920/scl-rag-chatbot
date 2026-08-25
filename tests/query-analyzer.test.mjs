import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeQuery, INTENTS } from '../server/rag/queryAnalyzer.js';
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
