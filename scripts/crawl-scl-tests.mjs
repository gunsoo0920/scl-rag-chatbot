import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildListUrl, parseTestListPage } from './lib/scl-test-parser.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-tests-raw.json');
const REPORT_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-tests-crawl-report.json');
const SAMPLE_PAGE_LIMIT = 3;
const REQUEST_DELAY_MS = Number.parseInt(process.env.SCL_CRAWL_DELAY_MS ?? '1000', 10);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

function parsePageArgument(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return fallback;

  const parsed = Number.parseInt(argument.slice(prefix.length), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${prefix}<양의 정수> 형식으로 입력해 주세요.`);
  }
  return parsed;
}

function parseStringArgument(name) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function fetchHtml(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
          'User-Agent': 'SCLPublicInfoCrawler/0.2 (+local development; respectful rate limit)',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const retryDelay = REQUEST_DELAY_MS * 2 ** (attempt - 1);
        console.warn(
          `  요청 실패 (${attempt}/${MAX_ATTEMPTS}), ${retryDelay}ms 후 재시도: ${error.message}`,
        );
        await wait(retryDelay);
      }
    }
  }

  throw new Error(`${url} 요청에 실패했습니다: ${lastError?.message ?? '알 수 없는 오류'}`);
}

function assertCrawl(records, startPage, endPage, sitePagination, crawlAll) {
  const requiredStringFields = ['id', 'testCode', 'sampleCode', 'testName', 'sourceUrl'];

  for (const record of records) {
    for (const field of requiredStringFields) {
      if (typeof record[field] !== 'string' || record[field].trim() === '') {
        throw new Error(`필수 필드가 비어 있습니다: ${record.id || '(id 없음)'}.${field}`);
      }
    }

    const sourceUrl = new URL(record.sourceUrl);
    if (
      sourceUrl.hostname !== 'www.scllab.co.kr' ||
      sourceUrl.pathname !== '/front/check/check_item_detail.do' ||
      sourceUrl.searchParams.get('itemcode') !== record.testCode ||
      sourceUrl.searchParams.get('sampcode') !== record.sampleCode
    ) {
      throw new Error(`원문 URL이 레코드 키와 일치하지 않습니다: ${record.sourceUrl}`);
    }
  }

  const uniqueIds = new Set(records.map((record) => record.id));
  if (uniqueIds.size !== records.length) {
    throw new Error(`중복 ID ${records.length - uniqueIds.size}건을 발견했습니다.`);
  }

  const expectedPages = endPage - startPage + 1;
  const collectedPages = new Set(records.map((record) => record.listPage));
  if (collectedPages.size !== expectedPages) {
    throw new Error(`요청한 ${expectedPages}페이지 중 ${collectedPages.size}페이지만 수집됐습니다.`);
  }
  for (let pageIndex = startPage; pageIndex <= endPage; pageIndex += 1) {
    if (!collectedPages.has(pageIndex)) {
      throw new Error(`페이지 ${pageIndex} 수집 결과가 없습니다.`);
    }
  }

  const rowNumbers = records.map((record) => record.rowNumber);
  const uniqueRowNumbers = new Set(rowNumbers);
  if (uniqueRowNumbers.size !== records.length) {
    throw new Error(`중복된 목록 순번 ${records.length - uniqueRowNumbers.size}건을 발견했습니다.`);
  }

  if (crawlAll) {
    if (!sitePagination) {
      throw new Error('전체 수집에 필요한 사이트 페이지 정보를 읽지 못했습니다.');
    }
    if (records.length !== sitePagination.totalRecords) {
      throw new Error(
        `사이트 총건수(${sitePagination.totalRecords})와 수집 건수(${records.length})가 다릅니다.`,
      );
    }
    for (let rowNumber = 1; rowNumber <= sitePagination.totalRecords; rowNumber += 1) {
      if (!uniqueRowNumbers.has(rowNumber)) {
        throw new Error(`목록 순번 ${rowNumber}가 누락됐습니다.`);
      }
    }
  }
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function main() {
  const startedAt = new Date().toISOString();
  const crawlAll = hasFlag('all');
  const startPage = parsePageArgument('start-page', 1);
  const requestedEndPage = parsePageArgument('end-page', SAMPLE_PAGE_LIMIT);
  const fixtureArgument = parseStringArgument('fixture');

  if (!Number.isInteger(REQUEST_DELAY_MS) || REQUEST_DELAY_MS < 500) {
    throw new Error('SCL_CRAWL_DELAY_MS는 서버 보호를 위해 500ms 이상이어야 합니다.');
  }
  if (crawlAll && fixtureArgument) {
    throw new Error('--all과 --fixture는 함께 사용할 수 없습니다.');
  }
  if (crawlAll && (startPage !== 1 || process.argv.some((value) => value.startsWith('--end-page=')))) {
    throw new Error('--all은 별도 시작/종료 페이지 인자 없이 사용해 주세요.');
  }
  if (startPage > requestedEndPage) {
    throw new Error('start-page는 end-page보다 클 수 없습니다.');
  }
  if (!crawlAll && requestedEndPage > SAMPLE_PAGE_LIMIT) {
    throw new Error(`현재 샘플 모드는 ${SAMPLE_PAGE_LIMIT}페이지까지만 허용합니다.`);
  }
  if (fixtureArgument && startPage !== requestedEndPage) {
    throw new Error('단일 HTML 픽스처는 한 페이지만 검증할 수 있습니다.');
  }

  const records = [];
  let sitePagination = null;
  let endPage = requestedEndPage;

  for (let pageIndex = startPage; pageIndex <= endPage; pageIndex += 1) {
    const listUrl = buildListUrl(pageIndex);
    console.log(`[${pageIndex}/${crawlAll && !sitePagination ? '?' : endPage}] ${listUrl}`);
    const html = fixtureArgument
      ? await readFile(resolve(PROJECT_ROOT, fixtureArgument), 'utf8')
      : await fetchHtml(listUrl);
    const parsed = parseTestListPage(html, pageIndex);

    if (!parsed.pagination) {
      throw new Error(`페이지 ${pageIndex}에서 페이지 정보를 읽지 못했습니다.`);
    }
    if (parsed.pagination.currentPage !== pageIndex) {
      throw new Error(
        `페이지 ${pageIndex} 요청에 페이지 ${parsed.pagination.currentPage} 응답이 반환됐습니다.`,
      );
    }
    if (sitePagination && parsed.pagination.totalRecords !== sitePagination.totalRecords) {
      throw new Error(
        `수집 중 사이트 총건수가 ${sitePagination.totalRecords}에서 ${parsed.pagination.totalRecords}(으)로 변경됐습니다.`,
      );
    }
    if (!sitePagination) {
      sitePagination = parsed.pagination;
      if (crawlAll) {
        endPage = sitePagination.totalPages;
        console.log(`  전체 범위 확인: ${sitePagination.totalRecords}건 / ${endPage}페이지`);
      }
    }

    for (const record of parsed.records) {
      record.captureMode = fixtureArgument ? 'fixture' : 'live';
    }
    records.push(...parsed.records);
    console.log(`  ${parsed.records.length}건 수집`);

    if (pageIndex < endPage) {
      await wait(REQUEST_DELAY_MS);
    }
  }

  assertCrawl(records, startPage, endPage, sitePagination, crawlAll);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });

  const completedAt = new Date().toISOString();
  const report = {
    mode: fixtureArgument ? 'fixture' : crawlAll ? 'full' : 'sample',
    sourceUrl: buildListUrl(1),
    startPage,
    endPage,
    siteTotalPages: sitePagination?.totalPages ?? null,
    siteTotalRecords: sitePagination?.totalRecords ?? null,
    collectedRecords: records.length,
    requestDelayMs: fixtureArgument ? 0 : REQUEST_DELAY_MS,
    startedAt,
    completedAt,
  };

  await writeJsonAtomically(OUTPUT_PATH, records);
  await writeJsonAtomically(REPORT_PATH, report);

  console.log('');
  console.log(`SCL ${report.mode} crawl completed`);
  console.log(`Pages: ${startPage}-${endPage}`);
  console.log(`Records: ${records.length}`);
  if (sitePagination) {
    console.log(`Site snapshot: ${sitePagination.totalRecords} records / ${sitePagination.totalPages} pages`);
  }
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(`SCL crawl failed: ${error.message}`);
  process.exitCode = 1;
});
