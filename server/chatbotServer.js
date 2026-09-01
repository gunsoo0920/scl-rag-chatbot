import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from './loadEnvironment.js';
import { GeminiEmbeddingService } from './rag/embeddingService.js';
import { GeminiGenerationService } from './rag/ragAnswerService.js';
import { IntentAwareAnswerService } from './rag/intentAwareAnswerService.js';
import { QueryMetrics } from './rag/queryMetrics.js';
import { QdrantStore } from './rag/qdrantStore.js';
import { RetrievalRouter } from './rag/retrievalRouter.js';
import { isOfficialSclUrl } from './rag/responseValidator.js';

const SERVER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SERVER_DIRECTORY, '..');
const DEFAULT_BODY_LIMIT_BYTES = 32 * 1024;

export class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Gemini API 키가 설정되지 않아 답변 생성을 사용할 수 없습니다.') {
    super(503, message, 'GENERATION_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}

class UnavailableGenerationService {
  async generateGroundedAnswer() {
    throw new ServiceUnavailableError();
  }
}

function parseAllowedOrigins(value) {
  return new Set(String(value || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function isSameOriginRequest(request, origin) {
  try {
    const originUrl = new URL(origin);
    const forwardedHost = String(request.headers['x-forwarded-host'] || request.headers.host || '').split(',')[0].trim();
    const forwardedProtocol = String(request.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    return Boolean(forwardedHost)
      && originUrl.host === forwardedHost
      && originUrl.protocol === `${forwardedProtocol}:`;
  } catch {
    return false;
  }
}

function setCommonHeaders(response, requestId) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Request-Id', requestId);
}

function writeJson(response, statusCode, payload, requestId) {
  const body = `${JSON.stringify(payload)}\n`;
  setCommonHeaders(response, requestId);
  response.statusCode = statusCode;
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(body);
}

async function readJsonBody(request, bodyLimitBytes) {
  const contentType = String(request.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, 'Content-Type은 application/json이어야 합니다.', 'UNSUPPORTED_MEDIA_TYPE');
  }

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > bodyLimitBytes) {
      throw new HttpError(413, `요청 본문은 ${bodyLimitBytes}바이트 이하여야 합니다.`, 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw new HttpError(400, 'JSON 요청 본문이 필요합니다.', 'EMPTY_BODY');

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '유효한 JSON 요청 본문이 아닙니다.', 'INVALID_JSON');
  }
}

function validateQuestion(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, '요청 본문은 JSON 객체여야 합니다.', 'INVALID_REQUEST');
  }
  if (typeof payload.question !== 'string' || !payload.question.trim()) {
    throw new HttpError(400, 'question은 비어 있지 않은 문자열이어야 합니다.', 'INVALID_QUESTION');
  }
  const question = payload.question.trim();
  if (question.length > 1000) {
    throw new HttpError(400, 'question은 1,000자 이하여야 합니다.', 'QUESTION_TOO_LONG');
  }
  return question;
}

export function validateChatbotApiResponse(payload) {
  if (!payload || typeof payload.answer !== 'string' || typeof payload.grounded !== 'boolean') {
    throw new Error('챗봇 응답의 answer 또는 grounded 형식이 올바르지 않습니다.');
  }
  if (/https?:\/\//iu.test(payload.answer)) throw new Error('챗봇 답변 본문에는 URL을 포함할 수 없습니다.');
  for (const field of ['matchedTests', 'sources', 'resources']) {
    if (!Array.isArray(payload[field])) throw new Error(`챗봇 응답의 ${field}가 배열이 아닙니다.`);
  }
  for (const matchedTest of payload.matchedTests) {
    if (!matchedTest?.id || !matchedTest.testCode || !matchedTest.testName) {
      throw new Error('챗봇 응답에 유효하지 않은 검사정보가 있습니다.');
    }
  }
  for (const source of payload.sources) {
    if (!source?.title || !isOfficialSclUrl(source.url)) throw new Error('챗봇 응답에 유효하지 않은 출처가 있습니다.');
  }
  for (const resource of payload.resources) {
    if (!['pdf', 'image'].includes(resource?.type) || !resource.title || !isOfficialSclUrl(resource.url)) {
      throw new Error('챗봇 응답에 유효하지 않은 리소스가 있습니다.');
    }
    if (resource.sourceUrl && !isOfficialSclUrl(resource.sourceUrl)) {
      throw new Error('챗봇 응답 리소스의 원문 URL이 유효하지 않습니다.');
    }
  }
  if (!payload.grounded && (payload.sources.length > 0 || payload.matchedTests.length > 0 || payload.resources.length > 0)) {
    throw new Error('grounded가 false인 응답에는 출처나 검사 자료를 포함할 수 없습니다.');
  }
  if (payload.grounded && payload.sources.length === 0) throw new Error('grounded 응답에는 공식 출처가 필요합니다.');
  if (!['EXACT', 'STRUCTURED', 'COMPARISON', 'VECTOR', 'CLARIFICATION', 'BLOCKED', 'NO_RESULT'].includes(payload.retrievalPath)) {
    throw new Error('챗봇 응답의 retrievalPath가 올바르지 않습니다.');
  }
  if (payload.presentation !== undefined && payload.presentation !== 'RESULTS_ONLY') {
    throw new Error('챗봇 응답의 presentation이 올바르지 않습니다.');
  }
  return payload;
}

export function createChatbotRequestHandler({
  answerService,
  serviceStatus = {},
  healthCheck = null,
  metrics = null,
  allowedOrigins = parseAllowedOrigins(process.env.CHATBOT_ALLOWED_ORIGINS),
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
  logger = console,
}) {
  if (!answerService?.answer) throw new Error('answerService가 필요합니다.');

  return async function chatbotRequestHandler(request, response) {
    const requestId = randomUUID();
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin) && !isSameOriginRequest(request, origin)) {
      writeJson(response, 403, { error: { code: 'ORIGIN_NOT_ALLOWED', message: '허용되지 않은 Origin입니다.', requestId } }, requestId);
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Access-Control-Max-Age', '600');
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const currentStatus = healthCheck ? await healthCheck() : serviceStatus;
        const healthy = currentStatus.nodeApi !== false
          && currentStatus.qdrantConnected !== false
          && currentStatus.collectionExists !== false;
        writeJson(response, 200, {
          status: healthy ? 'ok' : 'degraded',
          services: currentStatus,
        }, requestId);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/stats') {
        writeJson(response, 200, metrics?.snapshot?.() ?? {}, requestId);
        return;
      }

      if (url.pathname !== '/api/chatbot/interpret') {
        throw new HttpError(404, '요청한 API 경로를 찾을 수 없습니다.', 'NOT_FOUND');
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new HttpError(405, 'POST 요청만 허용됩니다.', 'METHOD_NOT_ALLOWED');
      }

      const payload = await readJsonBody(request, bodyLimitBytes);
      const question = validateQuestion(payload);
      const chatbotResponse = validateChatbotApiResponse(await answerService.answer(question));
      writeJson(response, 200, chatbotResponse, requestId);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      const code = error.code || 'INTERNAL_ERROR';
      const message = statusCode >= 500 && statusCode !== 503
        ? '챗봇 답변을 처리하는 중 오류가 발생했습니다.'
        : error.message;
      if (statusCode >= 500 && !(error instanceof ServiceUnavailableError)) {
        logger.error?.(`[${requestId}] ${error.stack || error.message}`);
      }
      writeJson(response, statusCode, { error: { code, message, requestId } }, requestId);
    }
  };
}

export function createChatbotServer(options) {
  return createServer(createChatbotRequestHandler(options));
}

export async function createRuntimeServices({
  apiKey = process.env.GEMINI_API_KEY,
  store = new QdrantStore(),
  metrics = new QueryMetrics(),
} = {}) {
  const embeddingService = apiKey?.trim()
    ? new GeminiEmbeddingService({ apiKey })
    : null;
  const generationAvailable = Boolean(apiKey?.trim());
  const generationService = generationAvailable
    ? new GeminiGenerationService({ apiKey })
    : new UnavailableGenerationService();
  const router = new RetrievalRouter({ store, embeddingService, metrics });
  const answerService = new IntentAwareAnswerService({ router, generationService, metrics });
  const healthCheck = async () => {
    const qdrant = await store.health();
    return {
      nodeApi: true,
      qdrantConnected: qdrant.connected,
      collectionExists: qdrant.collectionExists,
      collection: qdrant.collection,
      pointCount: qdrant.pointCount,
      vectorDimension: qdrant.dimension,
      embeddingConfigured: Boolean(apiKey?.trim() && process.env.GEMINI_EMBEDDING_MODEL && process.env.GEMINI_EMBEDDING_DIMENSION),
      generationAvailable,
    };
  };

  return {
    answerService,
    serviceStatus: await healthCheck(),
    healthCheck,
    metrics,
  };
}

export function startSyncScheduler({ logger = console } = {}) {
  if (String(process.env.SCL_SYNC_ENABLED).toLowerCase() !== 'true') return () => {};
  const interval = Number(process.env.SCL_SYNC_INTERVAL || 24 * 60 * 60 * 1000);
  if (!Number.isSafeInteger(interval) || interval < 60 * 60 * 1000) throw new Error('SCL_SYNC_INTERVAL은 1시간 이상의 밀리초 값이어야 합니다.');
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    const child = spawn(process.execPath, [resolve(PROJECT_ROOT, 'scripts/scl-sync.mjs')], {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      logger.error?.(`SCL scheduled sync 시작 실패: ${error.message}`);
      running = false;
    });
    child.once('exit', (code) => {
      if (code !== 0) logger.error?.(`SCL scheduled sync 실패: 종료 코드 ${code}`);
      running = false;
    });
  }, interval);
  timer.unref();
  return () => clearInterval(timer);
}

async function main() {
  loadEnvironment();
  const port = Number(process.env.CHATBOT_PORT || 3002);
  const host = process.env.CHATBOT_HOST || '127.0.0.1';
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) throw new Error('CHATBOT_PORT가 올바르지 않습니다.');

  const runtime = await createRuntimeServices();
  const server = createChatbotServer(runtime);
  const stopScheduler = startSyncScheduler();
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  server.listen(port, host, () => {
    console.log(`SCL chatbot server: http://${host}:${port}`);
    console.log(`Qdrant: ${runtime.serviceStatus.qdrantConnected ? 'connected' : 'unavailable'}`);
    console.log(`Collection: ${runtime.serviceStatus.collectionExists ? `${runtime.serviceStatus.pointCount} points` : 'missing'}`);
    console.log(`Embedding: ${runtime.serviceStatus.embeddingConfigured ? 'configured' : 'unavailable'}`);
    console.log(`Generation: ${runtime.serviceStatus.generationAvailable ? 'configured' : 'unavailable'}`);
  });

  const shutdown = () => {
    stopScheduler();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Chatbot server failed: ${error.message}`);
    process.exitCode = 1;
  });
}
