import { normalizeTestName } from './contentIdentity.js';

export const INTENTS = Object.freeze({
  FIELD_LOOKUP: 'FIELD_LOOKUP',
  COMPARISON: 'COMPARISON',
  SEARCH: 'SEARCH',
  EXPLANATION: 'EXPLANATION',
  RESOURCE_REQUEST: 'RESOURCE_REQUEST',
  MEDICAL_ADVICE: 'MEDICAL_ADVICE',
  UNKNOWN: 'UNKNOWN',
});

export const FIELD_ALIASES = Object.freeze({
  testCode: ['검사코드', '코드'],
  testName: ['검사명', '이름'],
  specimen: ['어떤 검체', '검체 종류', '검체'],
  method: ['검사방법', '검사 방법', '검사방식', '검사 방식', '어떻게 검사'],
  insuranceCode: ['보험코드', '보험 코드', '급여코드', '급여 코드'],
  schedule: ['검사 요일', '무슨 요일', '검사일', '언제 검사'],
  timeType: ['주간 검사', '야간 검사', '검사 구분'],
  turnaroundTime: ['결과 나오는 데', '결과 언제', '언제 나와', '며칠 걸려', '얼마나 걸려', '소요일', '소요 시간', '소요시간'],
  sourceUrl: ['공식 원문', '원문 링크', '출처', '공식 링크'],
  pdfUrls: ['pdf', '문서'],
  imageUrls: ['이미지', '사진', '검체용기'],
});

const COMPARISON_PATTERN = /(?:비교|차이|중\s*(?:어떤|뭐|무엇)|더\s*(?:빠|느|짧|길)|빨리\s*나오|빠른\s*편|느린\s*편)/iu;
const EXPLANATION_PATTERN = /(?:전체적|자세히|종합|설명|의의|알기\s*쉽게)/iu;
const RESOURCE_PATTERN = /(?:pdf|이미지|사진|검체용기|공식\s*(?:원문|링크)|출처|자료\s*(?:보여|줘|주세요))/iu;
const QUESTION_NOISE = /(?:안녕하세요|안녕|검사정보|검사\s*정보|검사|관련해서|관련|대해서|대한|좀|알려\s*줘|알려줘|알려\s*주세요|보여\s*줘|보여줘|뭐\s*있어|무엇이\s*있어|뭐야|인가요|주세요|해줘|설명해줘|정보)+/giu;

function findField(normalizedQuestion) {
  const entries = Object.entries(FIELD_ALIASES)
    .flatMap(([field, aliases]) => aliases.map((alias) => ({ field, alias: normalizeTestName(alias) })))
    .sort((left, right) => right.alias.length - left.alias.length);
  return entries.find(({ alias }) => normalizedQuestion.includes(alias))?.field ?? null;
}

function extractCandidateName(question, codes, field) {
  let candidate = String(question);
  for (const code of codes) candidate = candidate.replaceAll(code, ' ');
  for (const alias of Object.values(FIELD_ALIASES).flat()) candidate = candidate.replaceAll(alias, ' ');
  candidate = candidate.replace(/[?!.,()[\]{}]/g, ' ').replace(QUESTION_NOISE, ' ').replace(/\s+/g, ' ').trim();
  candidate = candidate.replace(/(?:은|는|이|가|을|를|의)$/u, '').trim();
  if (!candidate || (field && candidate.length < 2)) return null;
  return candidate;
}

export function analyzeQuery(question) {
  const value = String(question ?? '').trim();
  const normalizedQuestion = normalizeTestName(value);
  const testCodes = [...new Set(value.match(/(?<!\d)\d{4,8}(?!\d)/g) ?? [])];
  const field = findField(normalizedQuestion);
  let intent;
  if (COMPARISON_PATTERN.test(value)) intent = INTENTS.COMPARISON;
  else if (RESOURCE_PATTERN.test(value)) intent = INTENTS.RESOURCE_REQUEST;
  else if (field) intent = INTENTS.FIELD_LOOKUP;
  else if (EXPLANATION_PATTERN.test(value)) intent = INTENTS.EXPLANATION;
  else if (testCodes.length > 0) intent = INTENTS.SEARCH;
  else if (/[\p{L}\p{N}]/u.test(value)) intent = INTENTS.SEARCH;
  else intent = INTENTS.UNKNOWN;

  return {
    original: value,
    normalizedQuestion,
    entity: {
      testCodes,
      testName: extractCandidateName(value, testCodes, field),
      multiple: testCodes.length > 1,
    },
    intent,
    field,
  };
}
