import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIRECTORY, '..');

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
}

async function main() {
  const sourceRecords = await readJson('data/raw/scl-tests-raw.json');
  const details = await readJson('data/raw/scl-test-details-raw.json');
  const failures = await readJson('data/raw/scl-test-details-failures.json');
  const report = await readJson('data/raw/scl-test-details-crawl-report.json');
  const sourceById = new Map(sourceRecords.map((record) => [record.id, record]));
  const uniqueIds = new Set(details.map((record) => record.id));
  const uniqueFailureIds = new Set(failures.map((failure) => failure.id));
  const unknownRecords = details.filter((record) => !sourceById.has(record.id));
  const unknownFailures = failures.filter((failure) => !sourceById.has(failure.id));
  const detailFailureOverlap = failures.filter((failure) => uniqueIds.has(failure.id));
  const mismatchedSources = details.filter(
    (record) => sourceById.get(record.id)?.sourceUrl !== record.sourceUrl,
  );
  const missingDetailIdentity = details.filter(
    (record) => !record.detailCrawledAt || !record.detailTestName,
  );
  const invalidImages = [];
  let containerCount = 0;
  let imageCount = 0;

  for (const record of details) {
    for (const container of record.containers ?? []) {
      containerCount += 1;
      if (!container.imageUrl) continue;
      imageCount += 1;
      try {
        const url = new URL(container.imageUrl);
        if (!['www.scllab.co.kr', 'f-scl.scllab.co.kr'].includes(url.hostname)) {
          invalidImages.push(container.imageUrl);
        }
      } catch {
        invalidImages.push(container.imageUrl);
      }
    }
  }

  const remaining = sourceRecords.length - details.length;
  const coveredIds = new Set([...uniqueIds, ...uniqueFailureIds]);
  const unattemptedRecords = sourceRecords.filter((record) => !coveredIds.has(record.id));
  const reportMatches =
    report.sourceRecords === sourceRecords.length &&
    report.completedRecords === details.length &&
    report.remainingRecords === remaining &&
    report.failureRecords === failures.length;

  console.log('SCL Detail Crawl Validation');
  console.log(`Source records: ${sourceRecords.length}`);
  console.log(`Completed details: ${details.length}`);
  console.log(`Remaining details: ${remaining}`);
  console.log(`Failure records: ${failures.length}`);
  console.log(`Unattempted records: ${unattemptedRecords.length}`);
  console.log(`Unique IDs: ${uniqueIds.size}`);
  console.log(`Unique failure IDs: ${uniqueFailureIds.size}`);
  console.log(`Unknown records: ${unknownRecords.length}`);
  console.log(`Unknown failures: ${unknownFailures.length}`);
  console.log(`Detail/failure overlap: ${detailFailureOverlap.length}`);
  console.log(`Mismatched source URLs: ${mismatchedSources.length}`);
  console.log(`Missing detail identity: ${missingDetailIdentity.length}`);
  console.log(`Containers: ${containerCount}`);
  console.log(`Container images: ${imageCount}`);
  console.log(`Invalid image URLs: ${invalidImages.length}`);
  console.log(`Report matches data: ${reportMatches}`);
  console.log(`Coverage complete: ${coveredIds.size === sourceRecords.length}`);
  console.log(`Complete: ${details.length === sourceRecords.length}`);

  if (
    uniqueIds.size !== details.length ||
    uniqueFailureIds.size !== failures.length ||
    unknownRecords.length > 0 ||
    unknownFailures.length > 0 ||
    detailFailureOverlap.length > 0 ||
    unattemptedRecords.length > 0 ||
    mismatchedSources.length > 0 ||
    missingDetailIdentity.length > 0 ||
    invalidImages.length > 0 ||
    !reportMatches
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`SCL 전체 상세 검증 실패: ${error.message}`);
  process.exitCode = 1;
});
