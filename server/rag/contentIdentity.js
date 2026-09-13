import { createHash } from 'node:crypto';

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
  }
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim() : (value ?? '');
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
}

export function normalizeTestName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeInsuranceCode(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function insuranceCodeAliases(value) {
  const normalizedCode = normalizeInsuranceCode(value);
  if (!normalizedCode) return [];
  const baseCode = normalizedCode.replace(/ETC\d*$/u, '');
  return [...new Set([normalizedCode, baseCode].filter(Boolean))];
}

export function semanticContent(document) {
  return {
    testName: document.testName,
    specimen: document.specimen,
    method: document.method,
    schedule: document.schedule,
    timeType: document.timeType,
    turnaroundTime: document.turnaroundTime,
    content: document.content,
  };
}

export function calculateContentHash(document) {
  return hash(semanticContent(document));
}

export function calculatePayloadHash(document) {
  const insuranceCode = document.insuranceCode ?? document.metadata?.insuranceCode;
  return hash({
    id: document.id,
    testCode: document.testCode,
    sampleCode: document.sampleCode,
    insuranceCode,
    normalizedInsuranceCodes: insuranceCodeAliases(insuranceCode),
    keywords: document.keywords,
    sourceUrl: document.sourceUrl,
    pdfUrls: document.pdfUrls,
    imageUrls: document.imageUrls,
    resources: document.resources,
    active: document.active !== false,
  });
}

export function qdrantPointId(documentId) {
  const digest = createHash('sha256').update(String(documentId)).digest('hex').slice(0, 32).split('');
  digest[12] = '5';
  digest[16] = ['8', '9', 'a', 'b'][Number.parseInt(digest[16], 16) % 4];
  const value = digest.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function toQdrantPayload(document, { now = new Date().toISOString(), active = true } = {}) {
  const insuranceCode = document.insuranceCode ?? document.metadata?.insuranceCode ?? '';
  return {
    id: document.id,
    testCode: String(document.testCode ?? ''),
    sampleCode: String(document.sampleCode ?? ''),
    testName: document.testName ?? '',
    normalizedTestName: normalizeTestName(document.testName),
    specimen: document.specimen ?? '',
    method: document.method ?? '',
    insuranceCode,
    normalizedInsuranceCodes: insuranceCodeAliases(insuranceCode),
    schedule: document.schedule ?? '',
    timeType: document.timeType ?? '',
    turnaroundTime: document.turnaroundTime ?? '',
    content: document.content ?? '',
    keywords: document.keywords ?? [],
    sourceUrl: document.sourceUrl ?? '',
    pdfUrls: document.pdfUrls ?? [],
    imageUrls: document.imageUrls ?? [],
    resources: document.resources ?? [],
    metadata: document.metadata ?? {},
    crawledAt: document.crawledAt ?? document.metadata?.crawledAt ?? '',
    updatedAt: now,
    contentHash: calculateContentHash(document),
    payloadHash: calculatePayloadHash(document),
    active,
  };
}

export function embeddingDocument(payload) {
  return {
    title: `${payload.testName} 검사`,
    text: payload.content,
  };
}
