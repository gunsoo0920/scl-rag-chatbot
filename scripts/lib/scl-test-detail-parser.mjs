import * as cheerio from 'cheerio';

function normalizeText(value) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function nodeText($, node) {
  const cloned = $(node).clone();
  cloned.find('br').replaceWith('\n');
  return normalizeText(cloned.text());
}

function compactLabel(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function parseSchedule(rawSchedule) {
  const normalized = rawSchedule.replace(/\n/g, '').trim();
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex === -1) return { schedule: normalized, timeType: '' };
  return {
    schedule: normalized.slice(0, separatorIndex).trim(),
    timeType: normalized.slice(separatorIndex + 1).trim(),
  };
}

function absoluteUrl(value, sourceUrl) {
  if (!value) return '';
  return new URL(value, sourceUrl).toString();
}

function extractLabeledFields($) {
  const fields = new Map();

  $('table.wtable tr').each((_, row) => {
    const cells = $(row).children('th, td').toArray();
    if (cells.length < 2) return;

    const header = cells.find((cell) => cell.tagName?.toLowerCase() === 'th');
    if (header) {
      const valueCell = [...cells]
        .reverse()
        .find((cell) => cell.tagName?.toLowerCase() === 'td');
      if (valueCell) fields.set(compactLabel(nodeText($, header)), nodeText($, valueCell));
      return;
    }

    const firstCellLabel = nodeText($, cells[0]);
    if ($(cells[0]).find('.cred').length > 0) {
      fields.set(compactLabel(firstCellLabel), nodeText($, cells.at(-1)));
    }
  });

  return fields;
}

function extractContainers($, sourceUrl) {
  const containers = [];

  $('.chkViewInfo .checkViewer').each((_, viewer) => {
    const wrapper = $(viewer).parent();
    const attributes = {};
    wrapper.find('.checkInfoList li').each((__, item) => {
      const label = compactLabel(nodeText($, $(item).find('.key').first()));
      const value = nodeText($, $(item).find('.value').first());
      if (label) attributes[label] = value;
    });

    const title = nodeText($, $(viewer).find('.subj').first());
    const imageUrl = absoluteUrl($(viewer).find('img.listImg').first().attr('src'), sourceUrl);
    const precautionsEntry = Object.entries(attributes).find(([key]) => key.includes('주의사항'));
    const container = {
      title,
      imageUrl,
      additive: attributes['첨가제'] ?? '',
      mainTests: attributes['주요검사항목'] ?? '',
      collectionVolume: attributes['채취량'] ?? '',
      storage: attributes['보관'] ?? '',
      precautions: precautionsEntry?.[1] ?? '',
    };

    if (title || imageUrl) containers.push(container);
  });

  return containers.filter(
    (container, index) =>
      containers.findIndex(
        (candidate) => candidate.title === container.title && candidate.imageUrl === container.imageUrl,
      ) === index,
  );
}

export function parseTestDetailPage(html, sourceUrl) {
  const $ = cheerio.load(html);
  const fields = extractLabeledFields($);
  const detailTestCode = fields.get('SCL검사코드') ?? '';
  const detailTestName = fields.get('검사명') ?? '';

  if (!detailTestCode || !detailTestName) {
    throw new Error('상세 페이지에서 검사코드 또는 검사명을 찾지 못했습니다.');
  }

  const scheduleParts = parseSchedule(fields.get('검사요일') ?? '');
  const referenceText = fields.get('참고치') ?? '';
  const unitMatch = referenceText.match(/단위\s*:\s*([^\n]+)/);

  return {
    detailTestCode,
    detailTestName,
    method: fields.get('검사방법') ?? '',
    specimen: fields.get('검체명') ?? '',
    preservation: fields.get('보존방법') ?? '',
    requiredVolume: fields.get('소요량') ?? '',
    schedule: scheduleParts.schedule,
    timeType: scheduleParts.timeType,
    turnaroundTime: fields.get('검사소요일') ?? '',
    classificationNumber: fields.get('분류번호') ?? '',
    reimbursementCode: fields.get('급여코드') ?? '',
    nonCoveredCode: fields.get('비급여코드') ?? '',
    testPrice: fields.get('검사수가') ?? '',
    referenceRange: {
      text: referenceText,
      unit: unitMatch?.[1]?.trim() ?? '',
    },
    collectionPrecautions: fields.get('채취방법및주의사항') ?? '',
    clinicalSignificance: fields.get('임상적의의') ?? '',
    increaseNotes: fields.get('증가') ?? '',
    decreaseNotes: fields.get('감소') ?? '',
    reimbursementCriteria: fields.get('급여기준') ?? '',
    containers: extractContainers($, sourceUrl),
  };
}
