import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(SCRIPT_DIRECTORY, '..', 'data', 'raw', 'scl-tests-raw.json');
const REPORT_PATH = resolve(SCRIPT_DIRECTORY, '..', 'data', 'raw', 'scl-tests-crawl-report.json');
const REQUIRED_FIELDS = ['id', 'testCode', 'sampleCode', 'testName', 'sourceUrl'];
const DATA_FIELDS = [
  'testCode',
  'testName',
  'method',
  'specimen',
  'insuranceCode',
  'schedule',
  'timeType',
  'turnaroundTime',
  'sourceUrl',
];

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

async function main() {
  const records = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  if (!Array.isArray(records)) {
    throw new Error('최상위 JSON 값이 배열이 아닙니다.');
  }

  const missingRequired = [];
  const missingByField = Object.fromEntries(DATA_FIELDS.map((field) => [field, 0]));
  for (const record of records) {
    for (const field of REQUIRED_FIELDS) {
      if (isBlank(record[field])) {
        missingRequired.push(`${record.id ?? '(id 없음)'}.${field}`);
      }
    }
    for (const field of DATA_FIELDS) {
      if (isBlank(record[field])) {
        missingByField[field] += 1;
      }
    }
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  const uniqueRowNumbers = new Set(records.map((record) => record.rowNumber));
  const pages = [...new Set(records.map((record) => record.listPage))].sort((a, b) => a - b);
  const invalidSourceUrls = records.filter((record) => {
    try {
      const url = new URL(record.sourceUrl);
      return !(
        url.hostname === 'www.scllab.co.kr' &&
        url.pathname === '/front/check/check_item_detail.do' &&
        url.searchParams.get('itemcode') === record.testCode &&
        url.searchParams.get('sampcode') === record.sampleCode
      );
    } catch {
      return true;
    }
  });

  const pageGaps = [];
  for (let page = report.startPage; page <= report.endPage; page += 1) {
    if (!pages.includes(page)) pageGaps.push(page);
  }

  const rowGaps = [];
  if (report.mode === 'full') {
    for (let row = 1; row <= report.siteTotalRecords; row += 1) {
      if (!uniqueRowNumbers.has(row)) rowGaps.push(row);
    }
  }

  const reportMatches =
    report.collectedRecords === records.length &&
    (report.mode !== 'full' || report.siteTotalRecords === records.length);

  console.log('SCL Crawl Validation');
  console.log(`Mode: ${report.mode}`);
  console.log(`Total test records: ${records.length}`);
  console.log(`Pages: ${pages.length} (${pages.at(0)}-${pages.at(-1)})`);
  console.log(`Unique IDs: ${uniqueIds.size}`);
  console.log(`Unique row numbers: ${uniqueRowNumbers.size}`);
  console.log(`Missing required fields: ${missingRequired.length}`);
  console.log(`Invalid source URLs: ${invalidSourceUrls.length}`);
  console.log(`Missing pages: ${pageGaps.length}`);
  console.log(`Missing row numbers: ${rowGaps.length}`);
  console.log(`Report matches data: ${reportMatches}`);
  console.log('Empty field counts:');
  for (const [field, count] of Object.entries(missingByField)) {
    console.log(`  ${field}: ${count}`);
  }

  if (
    uniqueIds.size !== records.length ||
    uniqueRowNumbers.size !== records.length ||
    missingRequired.length > 0 ||
    invalidSourceUrls.length > 0 ||
    pageGaps.length > 0 ||
    rowGaps.length > 0 ||
    !reportMatches
  ) {
    if (missingRequired.length > 0) console.error(missingRequired.slice(0, 20).join('\n'));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`SCL crawl validation failed: ${error.message}`);
  process.exitCode = 1;
});
