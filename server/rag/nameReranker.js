import { normalizeTestName } from './contentIdentity.js';

const GENERIC_QUERY_TOKENS = new Set([
  '검사', '검사명', '검사항목', '정보', '관련', '관련해서', '대해서', '대한',
  '알려줘', '알려주세요', '검색', '찾아줘', '보여줘', '뭐야', '무엇',
  'test', 'tests', 'testing', 'information', 'related', 'disease',
]);
const LATIN_OR_GREEK_TOKEN = /[a-zα-ω]/iu;
const BROAD_SEMANTIC_PATTERN = /(?:관련|질환|질병|어떤\s*검사|무슨\s*검사|뭐\s*있어|목록|여러|disease|related|list)/iu;

export function nameTokens(value) {
  return normalizeTestName(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function editDistance(left, right) {
  const source = [...String(left)];
  const target = [...String(right)];
  const previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const current = [sourceIndex];
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitution = previous[targetIndex - 1] + (source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1);
      current[targetIndex] = Math.min(previous[targetIndex] + 1, current[targetIndex - 1] + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[target.length];
}

export function tokenSimilarity(left, right) {
  const maximumLength = Math.max([...String(left)].length, [...String(right)].length);
  return maximumLength === 0 ? 1 : 1 - editDistance(left, right) / maximumLength;
}

export function informativeNameTokens(question) {
  return [...new Set(nameTokens(question).filter((token) => !GENERIC_QUERY_TOKENS.has(token)))];
}

export function isBroadSemanticQuestion(question) {
  return BROAD_SEMANTIC_PATTERN.test(String(question));
}

function candidateContainsTerm(document, term) {
  const normalizedName = normalizeTestName(document.testName);
  if (LATIN_OR_GREEK_TOKEN.test(term)) return nameTokens(normalizedName).includes(term);
  return normalizedName.includes(term);
}

export function ambiguousCategoryTerm(question, documents, { minimumMatches = 2 } = {}) {
  if (isBroadSemanticQuestion(question)) return null;
  const tokens = informativeNameTokens(question);
  if (tokens.length !== 1) return null;
  const [term] = tokens;
  const matches = documents.filter((document) => candidateContainsTerm(document, term));
  return matches.length >= minimumMatches ? term : null;
}

function anchorTokens(tokens) {
  return tokens.filter((token) => token.length >= 2 && LATIN_OR_GREEK_TOKEN.test(token));
}

function bestTokenSimilarity(token, candidates) {
  return candidates.reduce((best, candidate) => Math.max(best, tokenSimilarity(token, candidate)), 0);
}

function nameSimilarity(queryTokens, candidateTokens) {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  return queryTokens.reduce((sum, token) => sum + bestTokenSimilarity(token, candidateTokens), 0) / queryTokens.length;
}

function vectorScore(document) {
  const score = Number(document.retrieval?.score ?? document.retrieval?.similarity ?? 0);
  return Number.isFinite(score) ? score : 0;
}

export function rerankSemanticDocuments(question, documents, { topK = 5 } = {}) {
  if (!Array.isArray(documents) || documents.length === 0) return [];
  if (isBroadSemanticQuestion(question)) return documents.slice(0, topK);
  const queryTokens = informativeNameTokens(question);
  const anchors = anchorTokens(queryTokens);
  // 직접 검사명 검색인데 영문·그리스 핵심 토큰이 없으면 vector 1위를 한 건만 사용한다.
  if (anchors.length === 0) return documents.slice(0, 1);

  const preparedDocuments = documents.map((document) => ({ document, candidateTokens: nameTokens(document.testName) }));
  const allCandidateTokens = [...new Set(preparedDocuments.flatMap((item) => item.candidateTokens))];
  const scoringTokens = queryTokens.filter((token) => (
    anchors.includes(token) || bestTokenSimilarity(token, allCandidateTokens) >= 0.4
  ));
  const candidates = preparedDocuments.map(({ document, candidateTokens }) => {
    const exactAnchor = anchors.some((anchor) => candidateTokens.includes(anchor));
    const fuzzyAnchor = Math.max(...anchors.map((anchor) => bestTokenSimilarity(anchor, candidateTokens)), 0);
    return {
      document,
      exactAnchor,
      fuzzyAnchor,
      nameScore: nameSimilarity(scoringTokens, candidateTokens),
      vectorScore: vectorScore(document),
    };
  });

  const hasExactAnchor = candidates.some((candidate) => candidate.exactAnchor);
  const anchored = candidates.filter((candidate) => (
    hasExactAnchor ? candidate.exactAnchor : candidate.fuzzyAnchor >= 0.75
  ));
  if (anchored.length === 0) return [];

  anchored.sort((left, right) => (
    right.nameScore - left.nameScore
    || right.vectorScore - left.vectorScore
    || String(left.document.testName).localeCompare(String(right.document.testName), 'ko-KR')
  ));

  // 후보 목록은 내부 재정렬에만 사용하고 직접 검사명 검색 결과는 가장 가까운 한 건만 노출한다.
  return anchored.slice(0, 1).map((candidate) => candidate.document);
}
