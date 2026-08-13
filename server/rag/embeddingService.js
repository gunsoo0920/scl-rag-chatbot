const API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429]);

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}은(는) 양의 정수여야 합니다.`);
  }
  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseMessage(payload, status) {
  return payload?.error?.message || payload?.message || `Gemini Embedding API HTTP ${status}`;
}

function durationMilliseconds(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Math.ceil(Number(match[1]) * 1000) : 0;
}

function serverRetryDelayMilliseconds(response, payload) {
  const retryAfter = response.headers?.get?.('retry-after');
  const headerSeconds = Number(retryAfter);
  const headerDelay = Number.isFinite(headerSeconds) && headerSeconds > 0 ? Math.ceil(headerSeconds * 1000) : 0;
  const retryInfo = payload?.error?.details?.find((detail) => String(detail?.['@type']).endsWith('RetryInfo'));
  return Math.max(headerDelay, durationMilliseconds(retryInfo?.retryDelay));
}

export function normalizeVector(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('임베딩 벡터는 유한한 숫자로 구성된 비어 있지 않은 배열이어야 합니다.');
  }
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error('영벡터는 정규화할 수 없습니다.');
  return values.map((value) => value / magnitude);
}

export class GeminiEmbeddingService {
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    dimension = process.env.GEMINI_EMBEDDING_DIMENSION || 768,
    batchSize = process.env.GEMINI_EMBEDDING_BATCH_SIZE || 20,
    requestDelayMs = process.env.GEMINI_EMBEDDING_REQUEST_DELAY_MS || 250,
    requestTimeoutMs = process.env.GEMINI_EMBEDDING_REQUEST_TIMEOUT_MS || 30000,
    maxRetries = process.env.GEMINI_EMBEDDING_MAX_RETRIES || 3,
    quotaRetryDelayMs = 0,
    fetchImpl = globalThis.fetch,
    sleepImpl = sleep,
    logger = console,
  } = {}) {
    if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY 환경변수가 필요합니다.');
    if (typeof fetchImpl !== 'function') throw new Error('fetch 구현이 필요합니다.');

    this.apiKey = apiKey.trim();
    this.model = model.replace(/^models\//, '');
    this.modelResource = `models/${this.model}`;
    this.dimension = positiveInteger(dimension, 768, 'GEMINI_EMBEDDING_DIMENSION');
    this.batchSize = positiveInteger(batchSize, 20, 'GEMINI_EMBEDDING_BATCH_SIZE');
    this.requestDelayMs = Math.max(0, Number(requestDelayMs) || 0);
    this.requestTimeoutMs = positiveInteger(requestTimeoutMs, 30000, 'GEMINI_EMBEDDING_REQUEST_TIMEOUT_MS');
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.quotaRetryDelayMs = Math.max(0, Number(quotaRetryDelayMs) || 0);
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.logger = logger;
  }

  async #post(method, body) {
    const endpoint = `${API_BASE_URL}/${this.modelResource}:${method}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let retryDelayMs = Math.min(1000 * 2 ** attempt, 8000);
      let quotaLimited = false;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) return payload;

        const retryable = RETRYABLE_STATUS_CODES.has(response.status) || response.status >= 500;
        if (response.status === 429) {
          quotaLimited = true;
          retryDelayMs = Math.max(
            retryDelayMs,
            this.quotaRetryDelayMs,
            serverRetryDelayMilliseconds(response, payload),
          );
        }
        if (!retryable || attempt === this.maxRetries) {
          const error = new Error(responseMessage(payload, response.status));
          error.retryable = retryable;
          throw error;
        }
      } catch (error) {
        const isLastAttempt = attempt === this.maxRetries;
        if (error.retryable === false || isLastAttempt) {
          if (error.name === 'AbortError') throw new Error(`Gemini Embedding API 요청이 ${this.requestTimeoutMs}ms 후 시간 초과되었습니다.`);
          throw error;
        }
      } finally {
        clearTimeout(timeout);
      }

      if (quotaLimited) {
        this.logger?.warn?.(
          `Gemini 임베딩 할당량 제한: ${Math.ceil(retryDelayMs / 1000)}초 후 재시도합니다 (${attempt + 1}/${this.maxRetries}).`,
        );
      }
      await this.sleepImpl(retryDelayMs);
    }

    throw new Error('Gemini Embedding API 요청이 예기치 않게 종료되었습니다.');
  }

  #validateAndNormalize(values) {
    if (!Array.isArray(values) || values.length !== this.dimension) {
      throw new Error(`임베딩 차원이 올바르지 않습니다. 기대값 ${this.dimension}, 실제값 ${values?.length ?? 0}`);
    }
    return normalizeVector(values);
  }

  async embedQuery(text) {
    if (!text?.trim()) throw new Error('임베딩할 질의가 비어 있습니다.');
    const payload = await this.#post('embedContent', {
      model: this.modelResource,
      content: { parts: [{ text: text.trim() }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: this.dimension,
    });
    return this.#validateAndNormalize(payload.embedding?.values);
  }

  async embedDocuments(documents) {
    if (!Array.isArray(documents) || documents.length === 0) return [];
    if (documents.length > this.batchSize) {
      throw new Error(`한 번에 임베딩할 문서 수는 ${this.batchSize}개 이하여야 합니다.`);
    }

    const requests = documents.map((document) => {
      if (!document?.text?.trim()) throw new Error('임베딩할 문서 내용이 비어 있습니다.');
      return {
        model: this.modelResource,
        content: { parts: [{ text: document.text.trim() }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        title: document.title?.trim() || undefined,
        outputDimensionality: this.dimension,
      };
    });

    const payload = await this.#post('batchEmbedContents', { requests });
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length !== documents.length) {
      throw new Error(`배치 임베딩 응답 수가 올바르지 않습니다. 기대값 ${documents.length}, 실제값 ${payload.embeddings?.length ?? 0}`);
    }
    return payload.embeddings.map((embedding) => this.#validateAndNormalize(embedding.values));
  }
}
