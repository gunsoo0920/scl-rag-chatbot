import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestKnowledgeDocument } from '../server/rag/knowledgeService.js';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const LIST_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-tests-raw.json');
const DETAIL_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-test-details-raw.json');
const FAILURE_PATH = resolve(PROJECT_ROOT, 'data', 'raw', 'scl-test-details-failures.json');
const PROCESSED_PATH = resolve(PROJECT_ROOT, 'data', 'processed', 'scl-tests.json');
const KNOWLEDGE_PATH = resolve(PROJECT_ROOT, 'server', 'rag', 'knowledge', 'scl-tests.json');
const REPORT_PATH = resolve(PROJECT_ROOT, 'data', 'processed', 'scl-tests-build-report.json');

async function writeJsonAtomically(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

function emptyDetailFields() {
  return {
    detailTestName: '',
    preservation: '',
    requiredVolume: '',
    classificationNumber: '',
    reimbursementCode: '',
    nonCoveredCode: '',
    testPrice: '',
    referenceRange: { text: '', unit: '' },
    collectionPrecautions: '',
    clinicalSignificance: '',
    increaseNotes: '',
    decreaseNotes: '',
    reimbursementCriteria: '',
    containers: [],
    detailCrawledAt: '',
  };
}

async function main() {
  const builtAt = new Date().toISOString();
  const listRecords = JSON.parse(await readFile(LIST_PATH, 'utf8'));
  const detailRecords = JSON.parse(await readFile(DETAIL_PATH, 'utf8'));
  const failures = JSON.parse(await readFile(FAILURE_PATH, 'utf8'));
  const detailById = new Map(detailRecords.map((record) => [record.id, record]));
  const failureById = new Map(failures.map((failure) => [failure.id, failure]));

  const processedRecords = listRecords.map((listRecord) => {
    const detailRecord = detailById.get(listRecord.id);
    if (detailRecord) {
      return { ...detailRecord, detailStatus: 'available' };
    }

    const failure = failureById.get(listRecord.id);
    if (!failure) throw new Error(`${listRecord.id}에 상세 데이터나 실패 기록이 없습니다.`);
    return {
      ...listRecord,
      ...emptyDetailFields(),
      detailStatus: 'unavailable',
      detailFailure: {
        reason: failure.error,
        attempts: failure.attempts,
        failedAt: failure.failedAt,
      },
    };
  });

  const knowledgeDocuments = processedRecords.map(buildTestKnowledgeDocument);
  const report = {
    builtAt,
    sourceRecords: listRecords.length,
    processedRecords: processedRecords.length,
    knowledgeDocuments: knowledgeDocuments.length,
    detailAvailable: processedRecords.filter((record) => record.detailStatus === 'available').length,
    detailUnavailable: processedRecords.filter((record) => record.detailStatus === 'unavailable').length,
    imageResources: knowledgeDocuments.reduce((count, document) => count + document.imageUrls.length, 0),
  };

  await writeJsonAtomically(PROCESSED_PATH, processedRecords);
  await writeJsonAtomically(KNOWLEDGE_PATH, knowledgeDocuments);
  await writeJsonAtomically(REPORT_PATH, report);

  console.log('SCL test knowledge build completed');
  console.log(`Processed records: ${processedRecords.length}`);
  console.log(`Knowledge documents: ${knowledgeDocuments.length}`);
  console.log(`Detail available: ${report.detailAvailable}`);
  console.log(`Detail unavailable: ${report.detailUnavailable}`);
  console.log(`Image resources: ${report.imageResources}`);
  console.log(`Processed output: ${PROCESSED_PATH}`);
  console.log(`Knowledge output: ${KNOWLEDGE_PATH}`);
}

main().catch((error) => {
  console.error(`SCL 지식 데이터 생성 실패: ${error.message}`);
  process.exitCode = 1;
});
