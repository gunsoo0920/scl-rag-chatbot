import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

export const SCL_BASE_URL = 'https://www.scllab.co.kr';
export const SCL_TEST_LIST_PATH = '/front/check/check_item_list.do';
export const SCL_TEST_DETAIL_PATH = '/front/check/check_item_detail.do';

const DETAIL_CALL_PATTERN =
  /fnActExamView\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/;

function normalizeText(value) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function cellText($, cell) {
  const cloned = $(cell).clone();
  cloned.find('br').replaceWith('\n');
  return normalizeText(cloned.text());
}

function splitSchedule(rawSchedule) {
  const normalized = rawSchedule.replace(/\n/g, '').trim();
  const separatorIndex = normalized.lastIndexOf('/');

  if (separatorIndex === -1) {
    return { schedule: normalized, timeType: '' };
  }

  return {
    schedule: normalized.slice(0, separatorIndex).trim(),
    timeType: normalized.slice(separatorIndex + 1).trim(),
  };
}

function makeStableId({ testCode, testName, sampleCode, specimen, method }) {
  const identity = [testCode, testName, sampleCode, specimen, method]
    .map((value) => value.toLocaleLowerCase('ko-KR').trim())
    .join('|');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return `test-${testCode}-${sampleCode}-${digest}`;
}

export function buildListUrl(pageIndex) {
  const url = new URL(SCL_TEST_LIST_PATH, SCL_BASE_URL);
  url.searchParams.set('pageIndex', String(pageIndex));
  return url.toString();
}

export function buildDetailUrl(testCode, sampleCode) {
  const url = new URL(SCL_TEST_DETAIL_PATH, SCL_BASE_URL);
  url.searchParams.set('itemcode', testCode);
  url.searchParams.set('sampcode', sampleCode);
  return url.toString();
}

export function parseTestListPage(html, pageIndex) {
  const $ = cheerio.load(html);
  const listUrl = buildListUrl(pageIndex);
  const crawledAt = new Date().toISOString();
  const records = [];

  $('tr[onclick*="fnActExamView"]').each((_, row) => {
    const onclick = $(row).attr('onclick') ?? '';
    const detailMatch = onclick.match(DETAIL_CALL_PATTERN);

    if (!detailMatch) {
      return;
    }

    const [, testCodeFromCall, sampleCode] = detailMatch;
    const cells = $(row).find('td').toArray().map((cell) => cellText($, cell));

    if (cells.length < 8) {
      throw new Error(
        `페이지 ${pageIndex}에서 예상과 다른 검사항목 행을 발견했습니다: 셀 ${cells.length}개`,
      );
    }

    const [rowNumber, testCode, testName, method, specimen, insuranceCode, rawSchedule, turnaroundTime] =
      cells;

    if (testCode !== testCodeFromCall) {
      throw new Error(
        `페이지 ${pageIndex}, 순번 ${rowNumber}: 행 검사코드(${testCode})와 상세 호출 검사코드(${testCodeFromCall})가 다릅니다.`,
      );
    }

    const scheduleParts = splitSchedule(rawSchedule);
    const record = {
      id: '',
      type: 'test',
      rowNumber: Number.parseInt(rowNumber, 10),
      testCode,
      sampleCode,
      testName,
      method,
      specimen,
      insuranceCode,
      schedule: scheduleParts.schedule,
      timeType: scheduleParts.timeType,
      turnaroundTime,
      sourceUrl: buildDetailUrl(testCode, sampleCode),
      listUrl,
      listPage: pageIndex,
      crawledAt,
    };

    record.id = makeStableId(record);
    records.push(record);
  });

  const pageSummary = normalizeText($('body').text()).match(
    /(\d+)\s*\/\s*(\d+)\s*\[\s*총\s*([\d,]+)\s*건\s*\]/,
  );

  if (records.length === 0) {
    throw new Error(`페이지 ${pageIndex}에서 검사항목 행을 찾지 못했습니다.`);
  }

  return {
    records,
    pagination: pageSummary
      ? {
          currentPage: Number.parseInt(pageSummary[1], 10),
          totalPages: Number.parseInt(pageSummary[2], 10),
          totalRecords: Number.parseInt(pageSummary[3].replaceAll(',', ''), 10),
        }
      : null,
  };
}
