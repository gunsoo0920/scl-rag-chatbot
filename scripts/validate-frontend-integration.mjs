import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const VITE_ENTRY = resolve(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function startNode(args, environment) {
  const output = [];
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...environment },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    output.push(chunk.toString());
    if (output.join('').length > 12000) output.shift();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  return { child, output };
}

async function stopProcess(processInfo) {
  const { child } = processInfo;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function waitForJson(url, processInfo, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (processInfo.child.exitCode !== null) {
      throw new Error(`프로세스가 조기 종료되었습니다.\n${processInfo.output.join('')}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return { response, payload: await response.json() };
    } catch {
      // 서버 시작 대기
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`서버 시작 시간 초과: ${url}\n${processInfo.output.join('')}`);
}

async function main() {
  const [apiPort, frontendPort] = await Promise.all([freePort(), freePort()]);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
  const apiProcess = startNode(['server/chatbotServer.js'], {
    GEMINI_API_KEY: '',
    CHATBOT_HOST: '127.0.0.1',
    CHATBOT_PORT: String(apiPort),
  });
  let frontendProcess;

  try {
    const directHealth = await waitForJson(`${apiBaseUrl}/api/health`, apiProcess);
    if (directHealth.payload.status !== 'degraded') throw new Error('키 없는 API가 degraded 상태가 아닙니다.');

    frontendProcess = startNode([
      VITE_ENTRY,
      '--host', '127.0.0.1',
      '--port', String(frontendPort),
      '--strictPort',
    ], { CHATBOT_PROXY_TARGET: apiBaseUrl });
    const proxiedHealth = await waitForJson(`${frontendBaseUrl}/api/health`, frontendProcess);
    if (proxiedHealth.payload.services?.knowledgeDocuments !== 3327) {
      throw new Error('Vite proxy health 응답의 지식 문서 수가 올바르지 않습니다.');
    }

    const pageResponse = await fetch(frontendBaseUrl);
    const pageHtml = await pageResponse.text();
    if (!pageResponse.ok || !pageHtml.includes('/src/main.jsx') || !pageHtml.includes('id="root"')) {
      throw new Error('Vite 프런트엔드 진입 페이지를 확인하지 못했습니다.');
    }

    const outOfScopeResponse = await fetch(`${frontendBaseUrl}/api/chatbot/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '오늘 날씨 알려줘' }),
    });
    const outOfScopePayload = await outOfScopeResponse.json();
    if (!outOfScopeResponse.ok || outOfScopePayload.grounded !== false) {
      throw new Error('키 없는 범위 밖 질문 경로가 올바르지 않습니다.');
    }

    const exactCodeResponse = await fetch(`${frontendBaseUrl}/api/chatbot/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '10130 검사 알려줘' }),
    });
    const exactCodePayload = await exactCodeResponse.json();
    if (
      !exactCodeResponse.ok
      || exactCodePayload.grounded !== true
      || exactCodePayload.matchedTests?.[0]?.testCode !== '10130'
    ) {
      throw new Error('키 없는 정확한 검사코드 조회 경로가 올바르지 않습니다.');
    }

    console.log('Frontend/API integration validation: PASS');
    console.log(`Frontend entry: ${pageResponse.status}`);
    console.log(`Proxied health: ${proxiedHealth.payload.status}`);
    console.log(`Knowledge documents: ${proxiedHealth.payload.services.knowledgeDocuments}`);
    console.log(`Out-of-scope request: ${outOfScopeResponse.status}, grounded=${outOfScopePayload.grounded}`);
    console.log(`Exact-code request: ${exactCodeResponse.status}, testCode=${exactCodePayload.matchedTests[0].testCode}`);
  } finally {
    if (frontendProcess) await stopProcess(frontendProcess);
    await stopProcess(apiProcess);
  }
}

main().catch((error) => {
  console.error(`Frontend/API integration validation failed: ${error.message}`);
  process.exitCode = 1;
});
