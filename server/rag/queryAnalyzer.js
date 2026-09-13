import { normalizeInsuranceCode, normalizeTestName } from './contentIdentity.js';

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
const NAME_TOKEN_SEPARATOR = /[?!,;:"“”'‘’{}]+/gu;
const MIXED_NAME_CHARACTER = /[a-z0-9α-ω]/iu;
const ATTACHED_PARTICLE = /^(.*[a-z0-9α-ω)\]_+\-])(?:에서는|에서|에게|한테|으로|부터|까지|처럼|보다|하고|이랑|랑|와|과|은|는|이|가|을|를|의|에|도|만|야)$/iu;
const MAX_NAME_CANDIDATES = 128;
const MAX_CANDIDATE_WORDS = 8;
const INSURANCE_CODE_CANDIDATE = /[a-z][a-z0-9.]{7,20}/giu;
const NAME_CANDIDATE_STOP_WORDS = new Set([
  '검사', '검사는', '검사의', '검사를', '검사가', '검사에서', '검사로', '검사만',
  '결과', '결과는', '정보', '관련', '관련해서', '대해서', '대한', '어떤', '무슨',
  '알려줘', '알려주세요', '사용하나요', '사용해', '궁금해', '궁금한', '뭐야', '무엇',
  '은', '는', '이', '가', '을', '를', '의', '에', '도', '만', '와', '과', '랑', '이랑',
  ...Object.values(FIELD_ALIASES).flat().map(normalizeTestName),
]);

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

function stripAttachedParticle(token) {
  if (!MIXED_NAME_CHARACTER.test(token)) return token;
  return token.match(ATTACHED_PARTICLE)?.[1] || token;
}

function candidateTokens(question) {
  return String(question)
    .normalize('NFKC')
    .replace(NAME_TOKEN_SEPARATOR, ' ')
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function meaningfulNameCandidate(value) {
  const normalized = normalizeTestName(value);
  return normalized.length >= 2 && !NAME_CANDIDATE_STOP_WORDS.has(normalized);
}

function looksLikeInsuranceCode(value) {
  const normalizedCode = normalizeInsuranceCode(value);
  if (normalizedCode.length < 8 || normalizedCode.length > 18) return false;
  const digitCount = (normalizedCode.match(/\d/g) ?? []).length;
  const letterCount = (normalizedCode.match(/[A-Z]/g) ?? []).length;
  return /^[A-Z][A-Z0-9]+$/u.test(normalizedCode) && digitCount >= 5 && letterCount >= 2;
}

function insuranceCodeMatches(question) {
  return [...String(question).matchAll(INSURANCE_CODE_CANDIDATE)]
    .filter((match) => looksLikeInsuranceCode(match[0]));
}

export function extractInsuranceCodes(question) {
  return [...new Set(insuranceCodeMatches(question).map((match) => normalizeInsuranceCode(match[0])))];
}

export function extractTestNameCandidates(question, codes = [], field = null) {
  const candidates = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = normalizeTestName(value);
    if (!meaningfulNameCandidate(normalized) || seen.has(normalized) || candidates.length >= MAX_NAME_CANDIDATES) return;
    seen.add(normalized);
    candidates.push(String(value).trim());
  };

  add(extractCandidateName(question, codes, field));
  const tokens = candidateTokens(question);

  // “A 말고 B”에서는 제외 대상 A보다 B를 먼저 검증한다.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (['말고', '대신'].includes(normalizeTestName(tokens[index]))) add(stripAttachedParticle(tokens[index + 1]));
  }

  // ALT, HbA1c처럼 영문·숫자·그리스 문자가 포함된 검사명은 문장 위치와 관계없이 우선 후보로 둔다.
  for (const token of tokens) {
    const stripped = stripAttachedParticle(token);
    if (MIXED_NAME_CHARACTER.test(stripped)) add(stripped);
  }

  // 실제 검사명 검증은 Qdrant keyword match가 담당하므로, 연속 어절 후보를 길이순으로 만든다.
  const maximumWords = Math.min(MAX_CANDIDATE_WORDS, tokens.length);
  for (let wordCount = maximumWords; wordCount >= 1 && candidates.length < MAX_NAME_CANDIDATES; wordCount -= 1) {
    for (let start = 0; start + wordCount <= tokens.length && candidates.length < MAX_NAME_CANDIDATES; start += 1) {
      const words = tokens.slice(start, start + wordCount);
      words[words.length - 1] = stripAttachedParticle(words.at(-1));
      add(words.join(' '));
    }
  }
  return candidates;
}

export function analyzeQuery(question) {
  const value = String(question ?? '').trim();
  const normalizedQuestion = normalizeTestName(value);
  const insuranceMatches = insuranceCodeMatches(value);
  const insuranceCodes = [...new Set(insuranceMatches.map((match) => normalizeInsuranceCode(match[0])))];
  let valueWithoutInsuranceCodes = value;
  for (const match of insuranceMatches) valueWithoutInsuranceCodes = valueWithoutInsuranceCodes.replaceAll(match[0], ' ');
  const testCodes = [...new Set(valueWithoutInsuranceCodes.match(/(?<!\d)\d{4,8}(?!\d)/g) ?? [])];
  const field = findField(normalizedQuestion);
  let intent;
  if (COMPARISON_PATTERN.test(value)) intent = INTENTS.COMPARISON;
  else if (RESOURCE_PATTERN.test(value)) intent = INTENTS.RESOURCE_REQUEST;
  else if (field) intent = INTENTS.FIELD_LOOKUP;
  else if (EXPLANATION_PATTERN.test(value)) intent = INTENTS.EXPLANATION;
  else if (testCodes.length > 0) intent = INTENTS.SEARCH;
  else if (/[\p{L}\p{N}]/u.test(value)) intent = INTENTS.SEARCH;
  else intent = INTENTS.UNKNOWN;

  const testNameCandidates = extractTestNameCandidates(value, testCodes, field);

  return {
    original: value,
    normalizedQuestion,
    entity: {
      testCodes,
      insuranceCodes,
      testName: testNameCandidates[0] ?? null,
      testNameCandidates,
      multiple: testCodes.length > 1,
    },
    intent,
    field,
  };
}
