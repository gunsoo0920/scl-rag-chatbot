import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchVectorIndex, validateVectorIndex } from './vectorStore.js';

const RAG_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_KNOWLEDGE_PATH = resolve(RAG_DIRECTORY, 'knowledge', 'scl-tests.json');
const DEFAULT_INDEX_PATH = resolve(RAG_DIRECTORY, 'index', 'vector-index.json');
const QUERY_STOP_WORDS = new Set([
  '검사', '검사는', '검사를', '검사의', '검사해', '검사항목', '정보', '관련', '대해', '대한',
  '알려줘', '알려', '주세요', '어떤', '뭐야', '무엇', '사용', '결과', '며칠', '걸려', '소요',
  '언제', '해', '하는', '하나요', '인가요', '이야', '이건', '그럼', '그리고', '보여줘',
  '결과는', '결과가', '결과를', '특검',
]);
const STRONG_LEXICAL_REASONS = new Set(['test-code-exact', 'test-name-exact', 'test-name-phrase']);

function numberSetting(value, fallback, name, { integer = false, minimum = -Infinity, maximum = Infinity } = {}) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed)) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 설정값이 올바르지 않습니다.`);
  }
  return parsed;
}

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeSearchText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function informativeQueryTokens(query) {
  return [...new Set(tokens(query).filter((token) => {
    if (QUERY_STOP_WORDS.has(token)) return false;
    return token.length >= 2 || /^\d+$/.test(token);
  }))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(haystack, needle) {
  if (!needle) return false;
  const needsBoundary = /^[a-z0-9]/i.test(needle) || /[a-z0-9]$/i.test(needle);
  if (!needsBoundary) return haystack.includes(needle);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, 'iu').test(haystack);
}

function prepareSearchDocument(document) {
  const normalizedName = normalizeSearchText(document.testName);
  const keywordValues = (document.keywords ?? []).map(normalizeSearchText).filter(Boolean);
  return {
    document,
    normalizedCode: normalizeSearchText(document.testCode),
    normalizedName,
    nameTokens: new Set(tokens(normalizedName)),
    keywordValues,
    keywordTokens: new Set(keywordValues.flatMap(tokens)),
  };
}

function scorePreparedLexicalMatch(prepared, { normalizedQuery, queryTokens }) {
  const { normalizedCode, normalizedName, nameTokens, keywordValues, keywordTokens } = prepared;
  const reasons = [];
  let score = 0;

  const codeExact = normalizedCode && containsTerm(normalizedQuery, normalizedCode);
  if (codeExact) {
    score += 1000;
    reasons.push('test-code-exact');
  }

  const nameExact = normalizedName && normalizedQuery === normalizedName;
  const namePhrase = normalizedName && !nameExact && containsTerm(normalizedQuery, normalizedName);
  if (nameExact) {
    score += 700;
    reasons.push('test-name-exact');
  } else if (namePhrase) {
    score += 600 + Math.min(normalizedName.length, 100);
    reasons.push('test-name-phrase');
  }

  if (queryTokens.length > 0) {
    const nameMatches = queryTokens.filter((token) => nameTokens.has(token));
    if (nameMatches.length > 0) {
      const coverage = nameMatches.length / queryTokens.length;
      score += Math.round(300 * coverage);
      reasons.push(coverage === 1 ? 'test-name-token-exact' : 'test-name-token-partial');
    }

    const keywordMatches = queryTokens.filter((token) => keywordTokens.has(token) && !nameTokens.has(token));
    if (keywordMatches.length > 0) {
      score += Math.round(120 * (keywordMatches.length / queryTokens.length));
      reasons.push('keyword-token');
    }
  }

  if (!nameExact && !namePhrase) {
    const keywordPhrase = keywordValues.some((keyword) => containsTerm(normalizedQuery, keyword));
    if (keywordPhrase) {
      score += 160;
      reasons.push('keyword-phrase');
    }
  }

  return { score, reasons, codeExact, nameExact, namePhrase };
}

export function scoreLexicalMatch(document, query) {
  const normalizedQuery = normalizeSearchText(query);
  return scorePreparedLexicalMatch(prepareSearchDocument(document), {
    normalizedQuery,
    queryTokens: informativeQueryTokens(normalizedQuery),
  });
}

export class RetrievalService {
  constructor({
    documents,
    vectorIndex = null,
    embeddingService = null,
    topK = process.env.RAG_TOP_K || 5,
    minSimilarity = process.env.RAG_MIN_SIMILARITY,
    semanticWeight = 100,
  }) {
    if (!Array.isArray(documents) || documents.length === 0) throw new Error('검색할 지식 문서가 비어 있습니다.');
    this.documents = documents;
    this.documentById = new Map(documents.map((document) => [document.id, document]));
    this.searchDocuments = documents.map(prepareSearchDocument);
    if (this.documentById.size !== documents.length) throw new Error('지식 문서 ID가 중복되었습니다.');
    this.topK = numberSetting(topK, 5, 'RAG_TOP_K', { integer: true, minimum: 1 });
    if (vectorIndex && embeddingService && (minSimilarity === undefined || minSimilarity === '')) {
      throw new Error('semantic 검색을 사용하려면 평가된 RAG_MIN_SIMILARITY 값이 필요합니다.');
    }
    this.minSimilarity = numberSetting(minSimilarity, 0, 'RAG_MIN_SIMILARITY', { minimum: -1, maximum: 1 });
    this.semanticWeight = numberSetting(semanticWeight, 100, 'semanticWeight', { minimum: 0 });
    this.embeddingService = embeddingService;
    this.vectorIndex = vectorIndex;

    if (vectorIndex) {
      const validation = validateVectorIndex(vectorIndex, { expectedDocumentIds: this.documentById.keys() });
      if (!validation.valid) throw new Error(`유효하지 않은 vector index: ${validation.errors[0]}`);
    }
  }

  get semanticAvailable() {
    return Boolean(this.vectorIndex && this.embeddingService);
  }

  async search(query, { topK = this.topK, minSimilarity = this.minSimilarity } = {}) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) throw new Error('검색 질의가 비어 있습니다.');
    const resolvedTopK = numberSetting(topK, this.topK, 'topK', { integer: true, minimum: 1 });
    const resolvedMinimum = numberSetting(minSimilarity, this.minSimilarity, 'minSimilarity', { minimum: -1, maximum: 1 });
    const candidates = new Map();
    const queryContext = {
      normalizedQuery,
      queryTokens: informativeQueryTokens(normalizedQuery),
    };

    for (const prepared of this.searchDocuments) {
      const { document } = prepared;
      const lexical = scorePreparedLexicalMatch(prepared, queryContext);
      if (lexical.score > 0) {
        candidates.set(document.id, {
          document,
          lexicalScore: lexical.score,
          similarity: null,
          matchReasons: lexical.reasons,
        });
      }
    }

    const hasStrongLexicalMatch = [...candidates.values()].some((candidate) => (
      candidate.matchReasons.some((reason) => STRONG_LEXICAL_REASONS.has(reason))
    ));

    if (this.semanticAvailable && !hasStrongLexicalMatch) {
      const queryVector = await this.embeddingService.embedQuery(query);
      const semanticResults = searchVectorIndex(this.vectorIndex, queryVector, {
        topK: Math.max(resolvedTopK * 4, 20),
        minSimilarity: resolvedMinimum,
      });
      for (const semantic of semanticResults) {
        const document = this.documentById.get(semantic.id);
        if (!document) continue;
        const candidate = candidates.get(semantic.id) ?? {
          document,
          lexicalScore: 0,
          similarity: null,
          matchReasons: [],
        };
        candidate.similarity = semantic.similarity;
        candidate.matchReasons.push('semantic');
        candidates.set(semantic.id, candidate);
      }
    }

    return [...candidates.values()]
      .map((candidate) => ({
        ...candidate.document,
        retrieval: {
          score: candidate.lexicalScore + Math.max(0, candidate.similarity ?? 0) * this.semanticWeight,
          lexicalScore: candidate.lexicalScore,
          similarity: candidate.similarity,
          matchReasons: [...new Set(candidate.matchReasons)],
        },
      }))
      .sort((left, right) => {
        const scoreDifference = right.retrieval.score - left.retrieval.score;
        if (scoreDifference !== 0) return scoreDifference;
        return left.testName.localeCompare(right.testName, 'ko-KR');
      })
      .slice(0, resolvedTopK);
  }
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function loadRetrievalService({
  knowledgePath = DEFAULT_KNOWLEDGE_PATH,
  indexPath = DEFAULT_INDEX_PATH,
  embeddingService = null,
  ...options
} = {}) {
  const [documents, vectorIndex] = await Promise.all([
    readJsonIfPresent(knowledgePath),
    readJsonIfPresent(indexPath),
  ]);
  if (!documents) throw new Error(`지식 문서를 찾을 수 없습니다: ${knowledgePath}`);
  return new RetrievalService({ documents, vectorIndex, embeddingService, ...options });
}
