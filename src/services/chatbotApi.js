const API_BASE_URL = String(import.meta.env.VITE_CHATBOT_API_URL || '').replace(/\/$/, '');

export class ChatbotApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', requestId = '' } = {}) {
    super(message);
    this.name = 'ChatbotApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function validateResponse(payload) {
  if (!payload || typeof payload.answer !== 'string' || typeof payload.grounded !== 'boolean') {
    throw new ChatbotApiError('서버 응답 형식이 올바르지 않습니다.', { code: 'INVALID_RESPONSE' });
  }
  for (const key of ['matchedTests', 'sources', 'resources']) {
    if (!Array.isArray(payload[key])) {
      throw new ChatbotApiError('서버 응답 형식이 올바르지 않습니다.', { code: 'INVALID_RESPONSE' });
    }
  }
  return payload;
}

export async function getChatbotHealth({ signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/health`, { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ChatbotApiError('챗봇 서버에 연결할 수 없습니다.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !['ok', 'degraded'].includes(payload.status)) {
    throw new ChatbotApiError('챗봇 서버 상태를 확인할 수 없습니다.', {
      status: response.status,
      code: payload?.error?.code || 'HEALTH_CHECK_FAILED',
    });
  }
  return payload;
}

export async function interpretQuestion(question, { signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/chatbot/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ChatbotApiError('챗봇 서버에 연결할 수 없습니다. 서버 실행 상태를 확인해 주세요.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ChatbotApiError(
      payload?.error?.message || '답변을 가져오지 못했습니다.',
      {
        status: response.status,
        code: payload?.error?.code || 'API_ERROR',
        requestId: payload?.error?.requestId || response.headers.get('x-request-id') || '',
      },
    );
  }
  return validateResponse(payload);
}
