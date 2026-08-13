import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SERVER_DIRECTORY, '..');

function parseValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '').trim();
}

export function loadEnvironment(path = resolve(PROJECT_ROOT, '.env')) {
  if (!existsSync(path)) return false;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (process.env[name] === undefined) process.env[name] = parseValue(rawValue);
  }
  return true;
}

export function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다. .env.example을 복사해 .env를 만들고 값을 설정하세요.`);
  }
  return value;
}
