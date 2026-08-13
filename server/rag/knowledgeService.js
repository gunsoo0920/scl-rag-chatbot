function meaningful(value) {
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '-';
}

function uniqueMeaningful(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!meaningful(value)) continue;
    const normalized = value.trim();
    const key = normalized.toLocaleLowerCase('ko-KR');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function addLine(lines, label, value) {
  if (meaningful(value)) lines.push(`${label}: ${value.trim()}`);
}

function buildContent(record) {
  const lines = [];
  addLine(lines, '검사명', record.testName);
  addLine(lines, 'SCL 검사코드', record.testCode);
  addLine(lines, '검사방법', record.method);
  addLine(lines, '검체명', record.specimen);
  addLine(lines, '보존방법', record.preservation);
  addLine(lines, '소요량', record.requiredVolume);
  addLine(lines, '검사일', record.schedule);
  addLine(lines, '검사 구분', record.timeType);
  addLine(lines, '검사 소요일', record.turnaroundTime);
  addLine(lines, '급여/비급여 코드', record.insuranceCode);
  addLine(lines, '분류번호', record.classificationNumber);
  addLine(lines, '급여코드', record.reimbursementCode);
  addLine(lines, '비급여코드', record.nonCoveredCode);
  addLine(lines, '검사수가', record.testPrice);
  addLine(lines, '참고치', record.referenceRange?.text);
  addLine(lines, '채취방법 및 주의사항', record.collectionPrecautions);
  addLine(lines, '임상적 의의', record.clinicalSignificance);
  addLine(lines, '증가 관련 정보', record.increaseNotes);
  addLine(lines, '감소 관련 정보', record.decreaseNotes);
  addLine(lines, '급여기준', record.reimbursementCriteria);

  for (const [index, container] of (record.containers ?? []).entries()) {
    const prefix = record.containers.length > 1 ? `검체용기 ${index + 1}` : '검체용기';
    addLine(lines, `${prefix} 이름`, container.title);
    addLine(lines, `${prefix} 첨가제`, container.additive);
    addLine(lines, `${prefix} 주요검사항목`, container.mainTests);
    addLine(lines, `${prefix} 채취량`, container.collectionVolume);
    addLine(lines, `${prefix} 보관`, container.storage);
    addLine(lines, `${prefix} 주의사항`, container.precautions);
  }

  return lines.join('\n');
}

export function buildTestKnowledgeDocument(record) {
  const imageUrls = uniqueMeaningful((record.containers ?? []).map((container) => container.imageUrl));
  const resources = (record.containers ?? [])
    .filter((container) => meaningful(container.title) || meaningful(container.imageUrl))
    .map((container) => ({
      type: 'image',
      title: meaningful(container.title) ? container.title.trim() : `${record.testName} 검체용기`,
      url: meaningful(container.imageUrl) ? container.imageUrl.trim() : '',
      sourceUrl: record.sourceUrl,
    }))
    .filter((resource) => resource.url);

  return {
    id: `knowledge-${record.id}`,
    sourceRecordId: record.id,
    type: 'test',
    title: `${record.testName} 검사`,
    content: buildContent(record),
    keywords: uniqueMeaningful([
      record.testCode,
      record.testName,
      record.method,
      record.specimen,
      record.insuranceCode,
    ]),
    testCode: record.testCode,
    sampleCode: record.sampleCode,
    testName: record.testName,
    method: record.method,
    specimen: record.specimen,
    schedule: record.schedule,
    timeType: record.timeType,
    turnaroundTime: record.turnaroundTime,
    sourceUrl: record.sourceUrl,
    pdfUrls: [],
    imageUrls,
    resources,
    metadata: {
      detailStatus: record.detailStatus,
      listPage: record.listPage,
      insuranceCode: record.insuranceCode,
      preservation: record.preservation,
      requiredVolume: record.requiredVolume,
      referenceRange: record.referenceRange,
    },
  };
}
