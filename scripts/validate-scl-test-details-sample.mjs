import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(SCRIPT_DIRECTORY, '..', 'data', 'raw', 'scl-test-details-sample.json');
const DETAIL_FIELDS = [
  'preservation',
  'requiredVolume',
  'classificationNumber',
  'reimbursementCode',
  'nonCoveredCode',
  'testPrice',
  'collectionPrecautions',
  'clinicalSignificance',
  'increaseNotes',
  'decreaseNotes',
  'reimbursementCriteria',
];

async function main() {
  const records = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('상세 샘플 데이터가 비어 있습니다.');
  }

  const emptyCounts = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, 0]));
  let containerCount = 0;
  let imageCount = 0;
  const invalidImages = [];

  for (const record of records) {
    if (!record.detailCrawledAt || record.detailTestName === undefined) {
      throw new Error(`${record.id}에 상세 수집 메타데이터가 없습니다.`);
    }
    for (const field of DETAIL_FIELDS) {
      if (typeof record[field] !== 'string' || record[field].trim() === '') emptyCounts[field] += 1;
    }
    for (const container of record.containers ?? []) {
      containerCount += 1;
      if (container.imageUrl) {
        imageCount += 1;
        const url = new URL(container.imageUrl);
        if (!['www.scllab.co.kr', 'f-scl.scllab.co.kr'].includes(url.hostname)) {
          invalidImages.push(container.imageUrl);
        }
      }
    }
  }

  console.log('SCL Detail Sample Validation');
  console.log(`Records: ${records.length}`);
  console.log(`Containers: ${containerCount}`);
  console.log(`Container images: ${imageCount}`);
  console.log(`Invalid image URLs: ${invalidImages.length}`);
  console.log('Empty optional field counts:');
  for (const [field, count] of Object.entries(emptyCounts)) console.log(`  ${field}: ${count}`);

  if (invalidImages.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`SCL 상세 샘플 검증 실패: ${error.message}`);
  process.exitCode = 1;
});
