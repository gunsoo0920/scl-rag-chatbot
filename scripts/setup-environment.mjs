import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(projectRoot, '.env.example');
const environmentPath = resolve(projectRoot, '.env');

if (process.env.VERCEL) {
  console.log('Vercel에서는 프로젝트 환경변수를 사용하므로 .env 생성을 생략합니다.');
} else {
  try {
    await copyFile(examplePath, environmentPath, constants.COPYFILE_EXCL);
    console.log('.env 파일을 .env.example에서 생성했습니다.');
    console.log('전체 AI 기능을 사용하려면 .env의 GEMINI_API_KEY를 설정하세요.');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('기존 .env 파일을 유지했습니다.');
  }
}
