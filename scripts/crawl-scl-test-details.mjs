import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTestDetailPage } from './lib/scl-test-detail-parser.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const LIST_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-tests-raw.json');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-test-details-raw.json');
const FAILURE_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-test-details-failures.json');
const REPORT_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-test-details-crawl-report.json');
const LOCK_PATH = resolve(PROJECT_ROOT, 'data', 'raw', '.scl-detail-crawl.lock');
const REQUEST_DELAY_MS = Number.parseInt(process.env.SCL_DETAIL_CRAWL_DELAY_MS ?? '1000', 10);
const CONCURRENCY = Number.parseInt(process.env.SCL_DETAIL_CRAWL_CONCURRENCY ?? '1', 10);
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const CHECKPOINT_INTERVAL = 10;
const MAX_CONCURRENCY = 2;
let releaseLock = async () => {};

function parseLimit() {
  const prefix = '--limit=';
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return null;
  const parsed = Number.parseInt(argument.slice(prefix.length), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--limit=<양의 정수> 형식으로 입력해 주세요.');
  }
  return parsed;
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function readJsonOrDefault(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function acquireLock() {
  try {
    const handle = await open(LOCK_PATH, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return async () => {
      await handle.close();
      await unlink(LOCK_PATH).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;

    const existing = await readJsonOrDefault(LOCK_PATH, null);
    let active = false;
    if (existing?.pid) {
      try {
        process.kill(existing.pid, 0);
        active = true;
      } catch (processError) {
        if (processError.code !== 'ESRCH') active = true;
      }
    }
    if (active) {
      throw new Error(`상세 크롤러가 이미 실행 중입니다 (PID ${existing.pid}).`);
    }

    await unlink(LOCK_PATH);
    return acquireLock();
  }
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
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const retryDelay = REQUEST_DELAY_MS * 2 ** (attempt - 1);
        console.warn(`  요청 실패 (${attempt}/${MAX_ATTEMPTS}), ${retryDelay}ms 후 재시도: ${error.message}`);
        await wait(retryDelay);
      }
    }
  }
  throw new Error(`${lastError?.message ?? '알 수 없는 오류'}`);
}

function enrichRecord(sourceRecord, detail) {
  if (detail.detailTestCode !== sourceRecord.testCode) {
    throw new Error(`응답 검사코드 ${detail.detailTestCode}가 요청 코드와 다릅니다.`);
  }

  return {
    ...sourceRecord,
    detailTestName: detail.detailTestName,
    method: detail.method || sourceRecord.method,
    specimen: detail.specimen || sourceRecord.specimen,
    preservation: detail.preservation,
    requiredVolume: detail.requiredVolume,
    schedule: detail.schedule || sourceRecord.schedule,
    timeType: detail.timeType || sourceRecord.timeType,
    turnaroundTime: detail.turnaroundTime || sourceRecord.turnaroundTime,
    classificationNumber: detail.classificationNumber,
    reimbursementCode: detail.reimbursementCode,
    nonCoveredCode: detail.nonCoveredCode,
    testPrice: detail.testPrice,
    referenceRange: detail.referenceRange,
    collectionPrecautions: detail.collectionPrecautions,
    clinicalSignificance: detail.clinicalSignificance,
    increaseNotes: detail.increaseNotes,
    decreaseNotes: detail.decreaseNotes,
    reimbursementCriteria: detail.reimbursementCriteria,
    containers: detail.containers,
    detailCrawledAt: new Date().toISOString(),
  };
}

function orderedCompletedRecords(sourceRecords, completedById) {
  return sourceRecords.map((record) => completedById.get(record.id)).filter(Boolean);
}

async function saveCheckpoint(sourceRecords, completedById, failuresById, report) {
  await writeJsonAtomically(OUTPUT_PATH, orderedCompletedRecords(sourceRecords, completedById));
  await writeJsonAtomically(FAILURE_PATH, [...failuresById.values()]);
  await writeJsonAtomically(REPORT_PATH, report);
}

async function main() {
  releaseLock = await acquireLock();
  const startedAt = new Date().toISOString();
  const crawlAll = process.argv.includes('--all');
  const limit = parseLimit();
  if (crawlAll === Boolean(limit)) {
    throw new Error('--all 또는 --limit 중 하나만 지정해 주세요.');
  }
  if (!Number.isInteger(REQUEST_DELAY_MS) || REQUEST_DELAY_MS < 500) {
    throw new Error('SCL_DETAIL_CRAWL_DELAY_MS는 서버 보호를 위해 500ms 이상이어야 합니다.');
  }
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > MAX_CONCURRENCY) {
    throw new Error(`SCL_DETAIL_CRAWL_CONCURRENCY는 1-${MAX_CONCURRENCY} 범위여야 합니다.`);
  }

  const sourceRecords = JSON.parse(await readFile(LIST_PATH, 'utf8'));
  const sourceById = new Map(sourceRecords.map((record) => [record.id, record]));
  const existingRecords = await readJsonOrDefault(OUTPUT_PATH, []);
  const existingFailures = await readJsonOrDefault(FAILURE_PATH, []);
  const completedById = new Map(
    existingRecords
      .filter(
        (record) =>
          sourceById.has(record.id) &&
          sourceById.get(record.id).sourceUrl === record.sourceUrl &&
          record.detailCrawledAt,
      )
      .map((record) => [record.id, record]),
  );
  const failuresById = new Map(
    existingFailures.filter((failure) => sourceById.has(failure.id)).map((failure) => [failure.id, failure]),
  );
  const remaining = sourceRecords.filter((record) => !completedById.has(record.id));
  const batch = crawlAll ? remaining : remaining.slice(0, limit);

  console.log(`전체 목록: ${sourceRecords.length}건`);
  console.log(`기존 완료: ${completedById.size}건`);
  console.log(`이번 실행 대상: ${batch.length}건`);
  console.log(`실행 후 예상 잔여: ${remaining.length - batch.length}건`);
  console.log(`동시성: ${CONCURRENCY}, 요청 그룹 간격: ${REQUEST_DELAY_MS}ms`);

  let succeededThisRun = 0;
  let failedThisRun = 0;

  async function processRecord(sourceRecord, index) {
    console.log(`[${index + 1}/${batch.length}] ${sourceRecord.testCode} ${sourceRecord.testName}`);
    try {
      const html = await fetchHtml(sourceRecord.sourceUrl);
      const detail = parseTestDetailPage(html, sourceRecord.sourceUrl);
      const enriched = enrichRecord(sourceRecord, detail);
      completedById.set(sourceRecord.id, enriched);
      failuresById.delete(sourceRecord.id);
      succeededThisRun += 1;
      console.log(`  ${sourceRecord.testCode} 완료, 검체용기 ${detail.containers.length}건`);
    } catch (error) {
      const previousAttempts = failuresById.get(sourceRecord.id)?.attempts ?? 0;
      failuresById.set(sourceRecord.id, {
        id: sourceRecord.id,
        testCode: sourceRecord.testCode,
        testName: sourceRecord.testName,
        sourceUrl: sourceRecord.sourceUrl,
        attempts: previousAttempts + 1,
        error: error.message,
        failedAt: new Date().toISOString(),
      });
      failedThisRun += 1;
      console.error(`  ${sourceRecord.testCode} 실패: ${error.message}`);
    }
  }

  for (let offset = 0; offset < batch.length; offset += CONCURRENCY) {
    const group = batch.slice(offset, offset + CONCURRENCY);
    await Promise.all(group.map((record, groupIndex) => processRecord(record, offset + groupIndex)));
    const processedThisRun = succeededThisRun + failedThisRun;
    if (processedThisRun % CHECKPOINT_INTERVAL === 0 || offset + group.length >= batch.length) {
      const report = {
        mode: crawlAll ? 'full' : 'batch',
        sourceRecords: sourceRecords.length,
        completedRecords: completedById.size,
        remainingRecords: sourceRecords.length - completedById.size,
        failureRecords: failuresById.size,
        succeededThisRun,
        failedThisRun,
        requestDelayMs: REQUEST_DELAY_MS,
        concurrency: CONCURRENCY,
        startedAt,
        checkpointedAt: new Date().toISOString(),
        complete: completedById.size === sourceRecords.length,
      };
      await saveCheckpoint(sourceRecords, completedById, failuresById, report);
      console.log(`  체크포인트: 전체 ${completedById.size}/${sourceRecords.length}건 완료`);
    }

    if (offset + group.length < batch.length) await wait(REQUEST_DELAY_MS);
  }

  console.log('');
  console.log(`이번 실행 성공: ${succeededThisRun}건`);
  console.log(`이번 실행 실패: ${failedThisRun}건`);
  console.log(`누적 완료: ${completedById.size}/${sourceRecords.length}건`);
  console.log(`누적 실패 기록: ${failuresById.size}건`);

  if (crawlAll && completedById.size !== sourceRecords.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`SCL 전체 상세 수집 실패: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await releaseLock();
  });
