import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIRECTORY, '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

async function main() {
  const sourceRecords = await readJson('data/raw/scl-tests-raw.json');
  const processedRecords = await readJson('data/processed/scl-tests.json');
  const documents = await readJson('server/rag/knowledge/scl-tests.json');
  const report = await readJson('data/processed/scl-tests-build-report.json');
  const sourceById = new Map(sourceRecords.map((record) => [record.id, record]));
  const processedById = new Map(processedRecords.map((record) => [record.id, record]));
  const uniqueDocumentIds = new Set(documents.map((document) => document.id));
  const uniqueSourceRecordIds = new Set(documents.map((document) => document.sourceRecordId));
  const invalidDocuments = [];
  const invalidKeywords = [];
  const invalidResources = [];
  const contentLengths = [];

  for (const document of documents) {
    const source = sourceById.get(document.sourceRecordId);
    const processed = processedById.get(document.sourceRecordId);
    if (
      !source ||
      !processed ||
      !document.title ||
      !document.content ||
      document.testCode !== source.testCode ||
      document.sourceUrl !== source.sourceUrl ||
      !document.content.includes(`SCL 검사코드: ${source.testCode}`)
    ) {
      invalidDocuments.push(document.id);
      continue;
    }

    const allowedKeywords = new Set(
      [source.testCode, source.testName, processed.method, processed.specimen, processed.insuranceCode]
        .filter((value) => typeof value === 'string' && value.trim() && value.trim() !== '-')
        .map((value) => value.trim().toLocaleLowerCase('ko-KR')),
    );
    for (const keyword of document.keywords) {
      if (!allowedKeywords.has(keyword.toLocaleLowerCase('ko-KR'))) {
        invalidKeywords.push({ id: document.id, keyword });
      }
    }

    for (const resource of document.resources) {
      try {
        const url = new URL(resource.url);
        if (!['www.scllab.co.kr', 'f-scl.scllab.co.kr'].includes(url.hostname)) {
          invalidResources.push(resource.url);
        }
      } catch {
        invalidResources.push(resource.url);
      }
    }
    contentLengths.push(document.content.length);
  }

  const missingSourceRecords = sourceRecords.filter((record) => !uniqueSourceRecordIds.has(record.id));
  const detailAvailable = processedRecords.filter((record) => record.detailStatus === 'available').length;
  const detailUnavailable = processedRecords.filter((record) => record.detailStatus === 'unavailable').length;
  const averageLength = Math.round(
    contentLengths.reduce((total, length) => total + length, 0) / contentLengths.length,
  );
  const reportMatches =
    report.sourceRecords === sourceRecords.length &&
    report.processedRecords === processedRecords.length &&
    report.knowledgeDocuments === documents.length &&
    report.detailAvailable === detailAvailable &&
    report.detailUnavailable === detailUnavailable;

  console.log('SCL Test Knowledge Validation');
  console.log(`Source records: ${sourceRecords.length}`);
  console.log(`Processed records: ${processedRecords.length}`);
  console.log(`Knowledge documents: ${documents.length}`);
  console.log(`Unique document IDs: ${uniqueDocumentIds.size}`);
  console.log(`Unique source record IDs: ${uniqueSourceRecordIds.size}`);
  console.log(`Missing source records: ${missingSourceRecords.length}`);
  console.log(`Invalid documents: ${invalidDocuments.length}`);
  console.log(`Invalid keywords: ${invalidKeywords.length}`);
  console.log(`Invalid resources: ${invalidResources.length}`);
  console.log(`Detail available/unavailable: ${detailAvailable}/${detailUnavailable}`);
  console.log(`Content length min/avg/max: ${Math.min(...contentLengths)}/${averageLength}/${Math.max(...contentLengths)}`);
  console.log(`Report matches outputs: ${reportMatches}`);

  if (
    processedRecords.length !== sourceRecords.length ||
    documents.length !== sourceRecords.length ||
    uniqueDocumentIds.size !== documents.length ||
    uniqueSourceRecordIds.size !== documents.length ||
    missingSourceRecords.length > 0 ||
    invalidDocuments.length > 0 ||
    invalidKeywords.length > 0 ||
    invalidResources.length > 0 ||
    !reportMatches
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`SCL 지식 데이터 검증 실패: ${error.message}`);
  process.exitCode = 1;
});
