import { buildSafeChatbotResponse, validateGeneratedAnswer } from './responseValidator.js';
import { assertSafeGeneratedOutput, evaluateSafety, MEDICAL_SAFETY_RESPONSE } from './safetyGate.js';
import { analyzeQuery, INTENTS } from './queryAnalyzer.js';
import { RETRIEVAL_PATHS } from './retrievalRouter.js';

const NO_INFORMATION_RESPONSE = Object.freeze({
  answer: 'SCL 공식 검사정보에서 질문과 일치하는 항목을 찾지 못했습니다. 검사명이나 검사코드를 확인해 다시 질문해 주세요.',
  grounded: false,
  matchedTests: [],
  sources: [],
  resources: [],
  retrievalPath: 'NO_RESULT',
});

const OUT_OF_SCOPE_RESPONSE = Object.freeze({
  answer: '이 챗봇은 SCL 검사정보 안내 전용입니다. 검사명이나 검사코드로 질문해 주세요.',
  grounded: false,
  matchedTests: [],
  sources: [],
  resources: [],
  retrievalPath: 'NO_RESULT',
});

const FIELD_LABELS = Object.freeze({
  testCode: '검사코드',
  testName: '검사명',
  specimen: '검체',
  method: '검사방법',
  insuranceCode: '보험코드',
  schedule: '검사일',
  timeType: '검사 구분',
  turnaroundTime: '소요일',
  sourceUrl: '공식 출처',
  pdfUrls: '관련 PDF',
  imageUrls: '관련 이미지',
});

const CASUAL_PATTERN = /^(?:안녕(?:하세요)?|하이|고마워|감사합니다?|오늘\s*날씨.*|점심.*추천.*|농담.*)[.!?~\s]*$/iu;

function meaningful(value) {
  return value !== null && value !== undefined && String(value).trim() !== '' && String(value).trim() !== '-';
}

function evidenceQuote(document, field) {
  const labels = {
    testCode: 'SCL 검사코드:', testName: '검사명:', specimen: '검체명:', method: '검사방법:',
    insuranceCode: '급여/비급여 코드:', schedule: '검사일:', timeType: '검사 구분:', turnaroundTime: '검사 소요일:',
  };
  const lines = String(document.content ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => field && line.startsWith(labels[field])) ?? lines[0] ?? `검사명: ${document.testName}`;
}

function groundedResponse(answer, documents, retrievalPath, field = null) {
  const uniqueDocuments = [...new Map(documents.map((document) => [document.id, document])).values()];
  const validated = {
    answer,
    grounded: true,
    sourceIds: uniqueDocuments.map((document) => document.id),
    evidence: uniqueDocuments.map((document) => ({ sourceId: document.id, quote: evidenceQuote(document, field) })),
  };
  return { ...buildSafeChatbotResponse(validated, uniqueDocuments), retrievalPath };
}

function displayName(document) {
  return `${document.testName} (검사코드 ${document.testCode}${document.sampleCode ? `, 검체코드 ${document.sampleCode}` : ''})`;
}

function exactResponse(documents) {
  if (documents.length === 1) {
    const document = documents[0];
    return groundedResponse(`검사코드 ${document.testCode}은(는) ${document.testName} 검사입니다.`, documents, RETRIEVAL_PATHS.EXACT, 'testName');
  }
  const lines = documents.slice(0, 5).map((document) => `• ${displayName(document)} — 검체 ${document.specimen || '정보 없음'}, 소요일 ${document.turnaroundTime || '정보 없음'}`);
  return groundedResponse(`조건에 맞는 SCL 검사정보 ${documents.length}건을 찾았습니다.\n${lines.join('\n')}`, documents.slice(0, 5), RETRIEVAL_PATHS.EXACT);
}

function fieldValue(document, field) {
  if (field === 'sourceUrl') return meaningful(document.sourceUrl) ? '아래 공식 출처에서 확인할 수 있습니다' : '';
  if (field === 'pdfUrls') return (document.pdfUrls ?? []).length ? `${document.pdfUrls.length}건` : '';
  if (field === 'imageUrls') return (document.imageUrls ?? []).length ? `${document.imageUrls.length}건` : '';
  return document[field];
}

function structuredResponse(documents, field) {
  const label = FIELD_LABELS[field] ?? field;
  const values = documents.map((document) => ({ document, value: fieldValue(document, field) }));
  const available = values.filter(({ value }) => meaningful(value));
  if (available.length === 0) {
    return groundedResponse(`해당 검사의 ${label} 정보는 현재 SCL 공식 데이터에 없습니다.`, documents, RETRIEVAL_PATHS.STRUCTURED, field);
  }
  if (available.length === 1) {
    const { document, value } = available[0];
    return groundedResponse(`${document.testName} 검사의 ${label}은(는) ${value}입니다.`, [document], RETRIEVAL_PATHS.STRUCTURED, field);
  }
  const lines = available.map(({ document, value }) => `• ${displayName(document)} — ${label} ${value}`);
  return groundedResponse(`검체별 ${label} 정보입니다.\n${lines.join('\n')}`, available.map(({ document }) => document), RETRIEVAL_PATHS.STRUCTURED, field);
}

export function parseTurnaroundDays(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '');
  if (/^(?:당일|1일이내)$/u.test(normalized)) return { minimum: 0, maximum: 1 };
  const range = normalized.match(/^(\d+)(?:일)?[~\-–—](\d+)일/u);
  if (range) return { minimum: Number(range[1]), maximum: Number(range[2]) };
  const single = normalized.match(/^(\d+)일/u);
  return single ? { minimum: Number(single[1]), maximum: Number(single[1]) } : null;
}

function comparisonResponse(documents, requestedCodes) {
  const groups = new Map();
  for (const document of documents) {
    const values = groups.get(document.testCode) ?? [];
    values.push(document);
    groups.set(document.testCode, values);
  }
  const orderedCodes = requestedCodes.length ? requestedCodes.filter((code) => groups.has(code)) : [...groups.keys()];
  const summary = orderedCodes.map((code) => {
    const group = groups.get(code);
    const durations = [...new Set(group.map((document) => document.turnaroundTime).filter(meaningful))];
    const parsed = durations.map(parseTurnaroundDays).filter(Boolean);
    return {
      code,
      group,
      durations,
      minimum: parsed.length ? Math.min(...parsed.map((value) => value.minimum)) : null,
      maximum: parsed.length ? Math.max(...parsed.map((value) => value.maximum)) : null,
    };
  });
  const detailLines = summary.map((item) => `• 검사코드 ${item.code} — 소요일 ${item.durations.join(', ') || '정보 없음'}`);
  let conclusion = '현재 확보한 SCL 공식 데이터만으로는 빠른 편인지 판단할 비교 기준이 없습니다.';
  if (summary.length === 2 && summary.every((item) => item.minimum !== null)) {
    const [left, right] = summary;
    if (left.maximum < right.minimum) conclusion = `검사코드 ${left.code}이(가) ${right.code}보다 소요일이 짧습니다.`;
    else if (right.maximum < left.minimum) conclusion = `검사코드 ${right.code}이(가) ${left.code}보다 소요일이 짧습니다.`;
    else if (left.minimum === right.minimum && left.maximum === right.maximum) conclusion = '두 검사의 공식 소요일은 같습니다.';
    else conclusion = '공식 소요일 범위가 겹치므로 어느 검사가 더 빠른지 단정할 수 없습니다.';
  }
  return groundedResponse(`${conclusion}\n${detailLines.join('\n')}`, documents, RETRIEVAL_PATHS.COMPARISON, 'turnaroundTime');
}

function resourceResponse(documents) {
  const pdfCount = documents.reduce((count, document) => count + (document.pdfUrls ?? []).length, 0);
  const imageCount = documents.reduce((count, document) => count + (document.imageUrls ?? []).length, 0);
  return groundedResponse(`공식 출처와 관련 자료를 확인했습니다.\n• PDF — ${pdfCount}건\n• 이미지 — ${imageCount}건`, documents, RETRIEVAL_PATHS.STRUCTURED);
}

function semanticResponse(documents) {
  const lines = documents.slice(0, 5).map((document) => `• ${displayName(document)} — ${document.specimen || '검체 정보 없음'}`);
  return groundedResponse(`의미상 관련성이 높은 SCL 검사정보 ${documents.length}건을 찾았습니다.\n${lines.join('\n')}`, documents.slice(0, 5), RETRIEVAL_PATHS.VECTOR);
}

export class IntentAwareAnswerService {
  constructor({ router, generationService, metrics }) {
    if (!router?.retrieve) throw new Error('retrieval router가 필요합니다.');
    this.router = router;
    this.generationService = generationService;
    this.metrics = metrics;
  }

  async answer(question) {
    const startedAt = this.metrics?.startTimer();
    this.metrics?.increment('totalQueries');
    const safety = evaluateSafety(question);
    if (safety.blocked) {
      this.metrics?.increment('blockedMedicalQueries');
      this.metrics?.recordLatency('BLOCKED', startedAt);
      return { ...MEDICAL_SAFETY_RESPONSE };
    }
    if (CASUAL_PATTERN.test(String(question).trim())) {
      this.metrics?.increment('noResultQueries');
      this.metrics?.recordLatency('NO_RESULT', startedAt);
      return { ...OUT_OF_SCOPE_RESPONSE };
    }

    const analysis = analyzeQuery(question);
    const retrieval = await this.router.retrieve(analysis);
    if (retrieval.path === RETRIEVAL_PATHS.NO_RESULT) {
      this.metrics?.increment('noResultQueries');
      this.metrics?.recordLatency('NO_RESULT', startedAt);
      return { ...NO_INFORMATION_RESPONSE };
    }

    const counterByPath = {
      EXACT: 'exactQueries', STRUCTURED: 'structuredQueries', COMPARISON: 'comparisonQueries', VECTOR: 'vectorQueries',
    };
    this.metrics?.increment(counterByPath[retrieval.path]);

    let response;
    if (analysis.intent === INTENTS.EXPLANATION) {
      if (!this.generationService?.generateGroundedAnswer) {
        const error = new Error('자연어 설명에 필요한 Gemini Generate 설정을 사용할 수 없습니다.');
        error.statusCode = 503;
        error.code = 'GENERATION_UNAVAILABLE';
        throw error;
      }
      this.metrics?.increment('generationCalls');
      const generated = await this.generationService.generateGroundedAnswer(question, retrieval.documents);
      assertSafeGeneratedOutput(generated.answer);
      const validated = validateGeneratedAnswer(generated, retrieval.documents);
      response = { ...buildSafeChatbotResponse(validated, retrieval.documents), retrievalPath: retrieval.path };
    } else if (analysis.intent === INTENTS.COMPARISON) {
      response = comparisonResponse(retrieval.documents, analysis.entity.testCodes);
    } else if (analysis.intent === INTENTS.RESOURCE_REQUEST) {
      response = resourceResponse(retrieval.documents);
    } else if (analysis.intent === INTENTS.FIELD_LOOKUP && analysis.field) {
      response = structuredResponse(retrieval.documents, analysis.field);
    } else if (retrieval.path === RETRIEVAL_PATHS.VECTOR) {
      response = semanticResponse(retrieval.documents);
    } else {
      response = exactResponse(retrieval.documents);
    }
    this.metrics?.recordLatency(retrieval.path, startedAt);
    return response;
  }
}
