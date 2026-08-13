import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTestDetailPage } from './lib/scl-test-detail-parser.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const INPUT_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-tests-raw.json');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-test-details-sample.json');
const REQUEST_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

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
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = REQUEST_DELAY_MS * 2 ** (attempt - 1);
        console.warn(`  요청 실패, ${delay}ms 후 재시도: ${error.message}`);
        await wait(delay);
      }
    }
  }
  throw new Error(`${url} 요청에 실패했습니다: ${lastError?.message ?? '알 수 없는 오류'}`);
}

function selectRepresentativeRecords(records) {
  const candidates = [
    records[0],
    records[1],
    records.find((record) => record.testCode === '11380' && record.sampleCode === '100'),
    records.find((record) => record.testCode === '10130'),
  ].filter(Boolean);

  return candidates.filter(
    (record, index) => candidates.findIndex((candidate) => candidate.id === record.id) === index,
  );
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

async function main() {
  const records = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
  const selected = selectRepresentativeRecords(records);
  if (selected.length !== 4) {
    throw new Error(`대표 상세 항목 4건 중 ${selected.length}건만 선택됐습니다.`);
  }

  const enrichedRecords = [];
  for (let index = 0; index < selected.length; index += 1) {
    const sourceRecord = selected[index];
    console.log(`[${index + 1}/${selected.length}] ${sourceRecord.testCode} ${sourceRecord.testName}`);
    const html = await fetchHtml(sourceRecord.sourceUrl);
    const detail = parseTestDetailPage(html, sourceRecord.sourceUrl);

    if (detail.detailTestCode !== sourceRecord.testCode) {
      throw new Error(
        `${sourceRecord.testCode} 요청에서 다른 검사코드 ${detail.detailTestCode}가 반환됐습니다.`,
      );
    }

    enrichedRecords.push({
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
    });
    console.log(`  상세 필드 수집, 검체용기 ${detail.containers.length}건`);

    if (index < selected.length - 1) await wait(REQUEST_DELAY_MS);
  }

  await writeJsonAtomically(OUTPUT_PATH, enrichedRecords);
  console.log(`상세 샘플 ${enrichedRecords.length}건 저장: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(`SCL 상세 샘플 수집 실패: ${error.message}`);
  process.exitCode = 1;
});
