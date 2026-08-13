import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGroundingPrompt,
  GeminiGenerationService,
  RagAnswerService,
  SCL_SYSTEM_INSTRUCTION,
} from '../server/rag/ragAnswerService.js';
import {
  buildSafeChatbotResponse,
  isOfficialSclUrl,
  validateGeneratedAnswer,
} from '../server/rag/responseValidator.js';

const altDocument = {
  id: 'knowledge-test-10130',
  title: 'ALT 검사',
  testCode: '10130',
  testName: 'ALT',
  specimen: 'Serum',
  method: 'Enzymatic method',
  schedule: '월,화,수,목,금,토',
  timeType: '야간',
  turnaroundTime: '1일',
  content: '검사명: ALT\n검사코드: 10130\n검체명: Serum\n검사 소요일: 1일',
  sourceUrl: 'https://www.scllab.co.kr/front/check/check_item_detail.do?itemcode=10130&sampcode=100',
  imageUrls: ['https://f-scl.scllab.co.kr/userdata/alt-tube.png'],
  pdfUrls: [],
  resources: [
    {
      type: 'image',
      title: 'Serum 용기',
      url: 'https://f-scl.scllab.co.kr/userdata/alt-tube.png',
      sourceUrl: 'https://www.scllab.co.kr/front/check/check_item_detail.do?itemcode=10130&sampcode=100',
    },
    { type: 'image', title: '위조 링크', url: 'https://example.com/fake.png' },
  ],
};

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test('Gemini 요청은 시스템 규칙과 sourceId enum을 가진 구조화 출력 스키마를 사용한다', async () => {
  let captured;
  const service = new GeminiGenerationService({
    apiKey: 'test-key',
    model: 'gemini-3.1-flash-lite',
    maxRetries: 0,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            answer: 'ALT 검체는 Serum입니다.',
            grounded: true,
            sourceIds: [altDocument.id],
            evidence: [{ sourceId: altDocument.id, quote: '검체명: Serum' }],
          }) }] },
        }],
      });
    },
  });

  const result = await service.generateGroundedAnswer('ALT 검체는?', [altDocument]);
  assert.equal(result.grounded, true);
  assert.match(captured.url, /models\/gemini-3\.1-flash-lite:generateContent$/);
  assert.match(captured.body.systemInstruction.parts[0].text, /참고자료만 사용/);
  assert.match(captured.body.systemInstruction.parts[0].text, /진단하거나/);
  assert.match(captured.body.systemInstruction.parts[0].text, /항목당 한 줄씩/);
  assert.match(captured.body.systemInstruction.parts[0].text, /350자 이내/);
  assert.match(captured.body.systemInstruction.parts[0].text, /최대 3개/);
  assert.equal(captured.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(
    captured.body.generationConfig.responseJsonSchema.properties.sourceIds.items.enum,
    [altDocument.id],
  );
});

test('grounding prompt는 질문과 검색 문서를 포함하고 URL 생성을 맡기지 않는다', () => {
  const prompt = buildGroundingPrompt('ALT 결과는?', [altDocument]);
  assert.match(prompt, /ALT 결과는\?/);
  assert.match(prompt, /검사 소요일: 1일/);
  assert.doesNotMatch(prompt, /check_item_detail\.do/);
  assert.match(SCL_SYSTEM_INSTRUCTION, /URL은 답변 문장에 직접 쓰거나 새로 만들지 마십시오/);
});

test('응답 검증은 검색 결과에 없는 sourceId를 거부한다', () => {
  assert.throws(() => validateGeneratedAnswer({
    answer: 'ALT 정보입니다.',
    grounded: true,
    sourceIds: ['invented-source'],
    evidence: [{ sourceId: 'invented-source', quote: '가짜 근거' }],
  }, [altDocument]), /검색 결과에 없는 sourceId/);
});

test('응답 검증은 저장되지 않은 URL을 거부한다', () => {
  assert.throws(() => validateGeneratedAnswer({
    answer: '자세한 내용은 https://example.com/fake 에서 확인하세요.',
    grounded: true,
    sourceIds: [altDocument.id],
    evidence: [{ sourceId: altDocument.id, quote: '검체명: Serum' }],
  }, [altDocument]), /저장된 자료에 없는 URL/);
});

test('서버 응답은 선택된 지식 문서에서 검사·출처·공식 리소스만 조립한다', () => {
  const validated = validateGeneratedAnswer({
    answer: 'ALT 검체는 Serum이며 검사 소요일은 1일입니다.',
    grounded: true,
    sourceIds: [altDocument.id],
    evidence: [{ sourceId: altDocument.id, quote: '검체명: Serum' }],
  }, [altDocument]);
  const response = buildSafeChatbotResponse(validated, [altDocument]);

  assert.equal(response.matchedTests[0].testCode, '10130');
  assert.equal(response.sources[0].url, altDocument.sourceUrl);
  assert.deepEqual(response.resources.map((resource) => resource.url), [altDocument.imageUrls[0]]);
  assert.equal(response.resources.some((resource) => resource.url.includes('example.com')), false);
});

test('공식 SCL HTTPS 하위 도메인만 링크로 허용한다', () => {
  assert.equal(isOfficialSclUrl('https://www.scllab.co.kr/front/main.do'), true);
  assert.equal(isOfficialSclUrl('https://f-scl.scllab.co.kr/file.pdf'), true);
  assert.equal(isOfficialSclUrl('http://www.scllab.co.kr/front/main.do'), false);
  assert.equal(isOfficialSclUrl('https://scllab.co.kr.example.com/fake'), false);
});

test('모델이 만든 evidence가 실제 원문에 없으면 거부한다', () => {
  assert.throws(() => validateGeneratedAnswer({
    answer: 'ALT 검사는 매일 시행합니다.',
    grounded: true,
    sourceIds: [altDocument.id],
    evidence: [{ sourceId: altDocument.id, quote: '검사일: 매일' }],
  }, [altDocument]), /원문에 존재하지 않는 evidence/);
});

test('검색 결과가 없으면 Gemini를 호출하지 않고 결정적 범위 밖 응답을 반환한다', async () => {
  let generationCalls = 0;
  const service = new RagAnswerService({
    retrievalService: { search: async () => [] },
    generationService: {
      generateGroundedAnswer: async () => {
        generationCalls += 1;
      },
    },
  });

  const response = await service.answer('존재하지 않는 검사명 ZZZ999 정보를 알려줘');
  assert.equal(response.grounded, false);
  assert.deepEqual(response.sources, []);
  assert.equal(generationCalls, 0);
});

test('일상 대화는 검색과 Gemini 호출 없이 검사정보 전용 안내를 반환한다', async () => {
  let retrievalCalls = 0;
  let generationCalls = 0;
  const service = new RagAnswerService({
    retrievalService: {
      search: async () => {
        retrievalCalls += 1;
        return [altDocument];
      },
    },
    generationService: {
      generateGroundedAnswer: async () => {
        generationCalls += 1;
      },
    },
  });

  for (const question of ['안녕하세요', '오늘 날씨 알려줘', '점심 메뉴 추천해줘', '재미있는 농담 해줘']) {
    const response = await service.answer(question);
    assert.equal(response.grounded, false);
    assert.match(response.answer, /일상적인 대화에는 답변할 수 없습니다/);
    assert.deepEqual(response.matchedTests, []);
  }
  assert.equal(retrievalCalls, 0);
  assert.equal(generationCalls, 0);
});

test('인사말이 포함돼도 검사정보 질문이면 일상 대화로 차단하지 않는다', async () => {
  let retrievalCalls = 0;
  const service = new RagAnswerService({
    retrievalService: {
      search: async () => {
        retrievalCalls += 1;
        return [altDocument];
      },
    },
    generationService: {
      generateGroundedAnswer: async () => ({
        answer: 'ALT 검체는 Serum입니다.',
        grounded: true,
        sourceIds: [altDocument.id],
        evidence: [{ sourceId: altDocument.id, quote: '검체명: Serum' }],
      }),
    },
  });

  const response = await service.answer('안녕하세요. ALT 검사 검체를 알려줘');
  assert.equal(retrievalCalls, 1);
  assert.equal(response.grounded, true);
  assert.equal(response.matchedTests[0].testCode, '10130');
});

test('증상 기반 검사 추천 질문은 검색과 Gemini 호출 없이 안전 안내를 반환한다', async () => {
  let retrievalCalls = 0;
  let generationCalls = 0;
  const service = new RagAnswerService({
    retrievalService: {
      search: async () => {
        retrievalCalls += 1;
        return [altDocument];
      },
    },
    generationService: {
      generateGroundedAnswer: async () => {
        generationCalls += 1;
      },
    },
  });

  const response = await service.answer('배가 아플 때 이용하는 검사들 싹 다 나열해줘');
  assert.equal(response.grounded, false);
  assert.match(response.answer, /특정 검사를 선택하거나 추천해 드릴 수 없습니다/);
  assert.match(response.answer, /\n\n/);
  assert.equal(retrievalCalls, 0);
  assert.equal(generationCalls, 0);
});

test('RAG 답변 서비스는 검색 결과와 검증된 모델 응답을 결합한다', async () => {
  const service = new RagAnswerService({
    retrievalService: { search: async () => [altDocument] },
    generationService: {
      generateGroundedAnswer: async () => ({
        answer: 'ALT 검사정보입니다. • 검체 — Serum • 소요일 — 1일',
        grounded: true,
        sourceIds: [altDocument.id],
        evidence: [{ sourceId: altDocument.id, quote: '검체명: Serum' }],
      }),
    },
  });

  const response = await service.answer('ALT 검체는?');
  assert.equal(response.answer, 'ALT 검사정보입니다.\n• 검체 — Serum\n• 소요일 — 1일');
  assert.equal(response.matchedTests[0].testName, 'ALT');
  assert.equal(response.sources.length, 1);
});

test('정확한 검사코드 질문은 Gemini를 호출하지 않고 저장된 필드값으로 답한다', async () => {
  let generationCalls = 0;
  const exactDocument = {
    ...altDocument,
    retrieval: {
      score: 1000,
      lexicalScore: 1000,
      similarity: null,
      matchReasons: ['test-code-exact'],
    },
  };
  const service = new RagAnswerService({
    retrievalService: { search: async () => [exactDocument] },
    generationService: {
      generateGroundedAnswer: async () => {
        generationCalls += 1;
        throw new Error('호출되면 안 됩니다.');
      },
    },
  });

  const response = await service.answer('10130 검사 정보 알려줘');
  assert.equal(generationCalls, 0);
  assert.match(response.answer, /검사코드 10130/);
  assert.match(response.answer, /ALT 검사/);
  assert.equal(response.matchedTests[0].testCode, '10130');
  assert.equal(response.matchedTests[0].specimen, 'Serum');
  assert.equal(response.matchedTests[0].method, 'Enzymatic method');
  assert.equal(response.matchedTests[0].turnaroundTime, '1일');
  assert.equal(response.sources[0].url, altDocument.sourceUrl);
});

test('빈 candidate나 차단된 응답은 정상 답변으로 처리하지 않는다', async () => {
  const service = new GeminiGenerationService({
    apiKey: 'test-key',
    maxRetries: 0,
    fetchImpl: async () => jsonResponse({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }),
  });

  await assert.rejects(
    () => service.generateGroundedAnswer('ALT 검체는?', [altDocument]),
    /SAFETY/,
  );
});
