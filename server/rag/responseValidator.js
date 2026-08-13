function uniqueBy(values, keySelector) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keySelector(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isOfficialSclUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'scllab.co.kr' || url.hostname.endsWith('.scllab.co.kr'));
  } catch {
    return false;
  }
}

export function collectStoredUrls(documents) {
  const urls = new Set();
  for (const document of documents) {
    for (const value of [
      document.sourceUrl,
      ...(document.pdfUrls ?? []),
      ...(document.imageUrls ?? []),
      ...(document.resources ?? []).flatMap((resource) => [resource.url, resource.sourceUrl]),
    ]) {
      if (typeof value === 'string' && value.trim() && isOfficialSclUrl(value.trim())) urls.add(value.trim());
    }
  }
  return urls;
}

function extractUrls(text) {
  return text.match(/https?:\/\/[^\s<>"')\]}]+/giu)?.map((url) => url.replace(/[.,!?;:]+$/, '')) ?? [];
}

export function validateGeneratedAnswer(payload, retrievedDocuments) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Gemini 응답은 JSON 객체여야 합니다.');
  }
  const allowedKeys = new Set(['answer', 'grounded', 'sourceIds', 'evidence']);
  const unknownKey = Object.keys(payload).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Gemini 응답에 허용되지 않은 필드가 있습니다: ${unknownKey}`);
  if (typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new Error('Gemini 응답의 answer가 비어 있습니다.');
  }
  if (payload.answer.length > 5000) throw new Error('Gemini 응답의 answer가 너무 깁니다.');
  if (typeof payload.grounded !== 'boolean') throw new Error('Gemini 응답의 grounded는 boolean이어야 합니다.');
  if (!Array.isArray(payload.sourceIds) || payload.sourceIds.some((id) => typeof id !== 'string')) {
    throw new Error('Gemini 응답의 sourceIds는 문자열 배열이어야 합니다.');
  }
  if (!Array.isArray(payload.evidence) || payload.evidence.some((item) => (
    !item || typeof item !== 'object' || typeof item.sourceId !== 'string' || typeof item.quote !== 'string'
  ))) {
    throw new Error('Gemini 응답의 evidence 형식이 올바르지 않습니다.');
  }

  const documentsById = new Map(retrievedDocuments.map((document) => [document.id, document]));
  const sourceIds = [...new Set(payload.sourceIds)];
  for (const sourceId of sourceIds) {
    if (!documentsById.has(sourceId)) throw new Error(`검색 결과에 없는 sourceId입니다: ${sourceId}`);
  }
  if (payload.grounded && sourceIds.length === 0) throw new Error('grounded 답변에는 sourceId가 필요합니다.');
  if (!payload.grounded && sourceIds.length > 0) throw new Error('grounded가 false이면 sourceIds는 비어 있어야 합니다.');
  if (payload.grounded && payload.evidence.length === 0) throw new Error('grounded 답변에는 원문 evidence가 필요합니다.');
  if (!payload.grounded && payload.evidence.length > 0) throw new Error('grounded가 false이면 evidence는 비어 있어야 합니다.');

  const evidence = payload.evidence.map((item) => {
    const document = documentsById.get(item.sourceId);
    if (!document) throw new Error(`검색 결과에 없는 evidence sourceId입니다: ${item.sourceId}`);
    const quote = item.quote.trim();
    if (!quote || quote.length > 500) throw new Error('evidence quote의 길이가 올바르지 않습니다.');
    const normalizedQuote = quote.replace(/\s+/g, ' ');
    const normalizedContent = String(document.content ?? '').replace(/\s+/g, ' ');
    if (!normalizedContent.includes(normalizedQuote)) {
      throw new Error(`원문에 존재하지 않는 evidence입니다: ${item.sourceId}`);
    }
    return { sourceId: item.sourceId, quote };
  });
  const selectedSourceIds = new Set(sourceIds);
  for (const item of evidence) {
    if (!selectedSourceIds.has(item.sourceId)) throw new Error(`sourceIds에 없는 evidence가 있습니다: ${item.sourceId}`);
  }
  const evidenceSourceIds = new Set(evidence.map((item) => item.sourceId));
  for (const sourceId of sourceIds) {
    if (!evidenceSourceIds.has(sourceId)) throw new Error(`sourceId에 대응하는 evidence가 없습니다: ${sourceId}`);
  }

  const storedUrls = collectStoredUrls(retrievedDocuments);
  for (const url of extractUrls(payload.answer)) {
    if (!storedUrls.has(url)) throw new Error(`저장된 자료에 없는 URL이 답변에 포함되었습니다: ${url}`);
  }

  return {
    answer: payload.answer.trim(),
    grounded: payload.grounded,
    sourceIds,
    evidence,
  };
}

function safeResources(document) {
  const resources = [];
  const seen = new Set();
  const addResource = (resource) => {
    const key = `${resource.type}:${resource.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    resources.push(resource);
  };

  for (const resource of document.resources ?? []) {
    if (!isOfficialSclUrl(resource.url)) continue;
    addResource({
      type: resource.type === 'pdf' ? 'pdf' : 'image',
      title: resource.title || document.testName,
      url: resource.url,
      sourceUrl: isOfficialSclUrl(resource.sourceUrl)
        ? resource.sourceUrl
        : (isOfficialSclUrl(document.sourceUrl) ? document.sourceUrl : ''),
    });
  }
  for (const url of document.pdfUrls ?? []) {
    if (isOfficialSclUrl(url)) addResource({ type: 'pdf', title: `${document.testName} 관련 PDF`, url, sourceUrl: document.sourceUrl });
  }
  for (const url of document.imageUrls ?? []) {
    if (isOfficialSclUrl(url)) addResource({ type: 'image', title: `${document.testName} 관련 이미지`, url, sourceUrl: document.sourceUrl });
  }
  return resources;
}

export function buildSafeChatbotResponse(validatedAnswer, retrievedDocuments) {
  const documentsById = new Map(retrievedDocuments.map((document) => [document.id, document]));
  const selectedDocuments = validatedAnswer.sourceIds.map((id) => documentsById.get(id)).filter(Boolean);

  return {
    answer: validatedAnswer.answer,
    grounded: validatedAnswer.grounded,
    matchedTests: selectedDocuments.map((document) => ({
      id: document.id,
      testCode: document.testCode,
      testName: document.testName,
      specimen: document.specimen,
      method: document.method,
      schedule: document.schedule,
      timeType: document.timeType,
      turnaroundTime: document.turnaroundTime,
    })),
    sources: uniqueBy(selectedDocuments
      .filter((document) => isOfficialSclUrl(document.sourceUrl))
      .map((document) => ({
        id: document.id,
        title: `${document.testName} 검사정보`,
        url: document.sourceUrl,
      })), (source) => source.url),
    resources: uniqueBy(selectedDocuments.flatMap(safeResources), (resource) => `${resource.type}:${resource.url}`),
  };
}
