export const MEDICAL_SAFETY_RESPONSE = Object.freeze({
  answer: '개인 검사결과의 해석, 질병 진단, 치료·약물 결정 또는 개인 맞춤 검사 추천은 제공할 수 없습니다. 담당 의료진과 상담해 주세요.\n\n검사명이나 검사코드를 알려주시면 SCL 공식 자료에 있는 검체, 검사방법, 검사일과 소요일은 안내해 드릴 수 있습니다.',
  grounded: false,
  matchedTests: [],
  sources: [],
  resources: [],
  retrievalPath: 'BLOCKED',
});

const MEDICAL_PATTERNS = [
  /(?:결과|수치|참고치).{0,30}(?:해석|판독|정상|비정상|높|낮|무슨\s*(?:병|질환)|어떤\s*(?:병|질환))/iu,
  /(?:높|낮|양성|음성)(?:으?면|인데|이면)?.{0,30}(?:무슨|어떤).{0,8}(?:병|질환)/iu,
  /(?:무슨|어떤)\s*(?:병|질환)(?:이|인|일|인가)/iu,
  /(?:진단|확진|병명).{0,20}(?:해|알려|뭐|무엇)/iu,
  /(?:어떤|무슨|뭘)\s*(?:약|치료|처방)/iu,
  /(?:약|약물).{0,20}(?:추천|복용|먹어|먹는|처방|용량)/iu,
  /(?:치료|수술).{0,20}(?:방법|추천|결정|해야|받아)/iu,
  /(?:나|저|환자|개인).{0,25}(?:검사).{0,15}(?:추천|골라|선택|받아야)/iu,
  /(?:증상|아프|통증|열이|기침|구토|설사|어지러).{0,40}(?:검사).{0,15}(?:추천|골라|선택|해야|받아)/iu,
];

export function evaluateSafety(question) {
  const value = String(question ?? '').trim();
  const blocked = MEDICAL_PATTERNS.some((pattern) => pattern.test(value));
  return { blocked, category: blocked ? 'MEDICAL_ADVICE' : null };
}

const UNSAFE_OUTPUT_PATTERNS = [
  /(?:당신|환자|이 결과).{0,30}(?:병|질환)(?:입니다|으로 보입니다|일 가능성)/iu,
  /(?:약|약물).{0,20}(?:복용|드세요|추천|처방)/iu,
  /(?:치료|수술).{0,20}(?:해야|권장|추천)/iu,
];

export function assertSafeGeneratedOutput(answer) {
  const violation = UNSAFE_OUTPUT_PATTERNS.find((pattern) => pattern.test(String(answer ?? '')));
  if (violation) throw new Error('생성 답변에 허용되지 않은 진단·치료·약물 조언이 포함되었습니다.');
}
