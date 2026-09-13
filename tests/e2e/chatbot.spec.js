import { expect, test } from '@playwright/test';

const SOURCE_URL = 'https://www.scllab.co.kr/front/check/check_item_detail.do?itemcode=10130&sampcode=100';
const IMAGE_URL = 'https://f-scl.scllab.co.kr/userdata/e2e-serum-tube.png';
const PDF_URL = 'https://f-scl.scllab.co.kr/userdata/e2e-request-form.pdf';
const SUCCESS_RESPONSE = {
  answer: 'ALT 검체는 Serum이며, 검사 소요일은 1일입니다.',
  grounded: true,
  retrievalPath: 'STRUCTURED',
  presentation: 'RESULTS_ONLY',
  matchedTests: [{
    id: 'knowledge-test-10130',
    testCode: '10130',
    testName: 'ALT',
    specimen: 'Serum',
    method: 'Enzymatic method',
    insuranceCode: 'D185000HZ',
    schedule: '월,화,수,목,금,토',
    timeType: '야간',
    turnaroundTime: '1일',
  }],
  sources: [{ id: 'knowledge-test-10130', title: 'ALT 검사정보', url: SOURCE_URL }],
  resources: [
    { type: 'image', title: 'Serum 용기', url: IMAGE_URL, sourceUrl: SOURCE_URL },
    { type: 'pdf', title: '검사의뢰서', url: PDF_URL, sourceUrl: SOURCE_URL },
  ],
};

async function mockHealth(page, status = 'ok') {
  await page.route('**/api/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      status,
      services: {
        generationAvailable: status === 'ok',
        semanticSearchAvailable: status === 'ok',
        vectorIndexAvailable: status === 'ok',
        knowledgeDocuments: 3327,
      },
    },
  }));
}

async function mockResourceFiles(page) {
  await page.route(IMAGE_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.route(PDF_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'application/pdf',
    body: '%PDF-1.4\n%%EOF',
  }));
}

test.beforeEach(async ({ page }) => {
  await mockHealth(page);
});

test('초기 챗봇 화면과 질문 예시가 표시된다', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '검사정보를 더 빠르고 쉽게' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SCL 검사정보 AI 도우미' })).toBeVisible();
  await expect(page.getByText('공식 공개정보 기반 안내')).toBeVisible();
  await expect(page.getByText('안녕하세요. 찾고 싶은 검사명이나 검사코드를 입력해 주세요.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ALT 검사는 어떤 검체를 사용하나요?' })).toBeVisible();
  await expect(page.getByLabel('검사정보 질문')).toBeEditable();

  const widgetBox = await page.locator('.chatbot-dock').boundingBox();
  expect(widgetBox.width).toBeLessThanOrEqual(410);
  expect(widgetBox.height).toBeLessThanOrEqual(680);

  await page.getByRole('button', { name: '챗봇 닫기' }).click();
  await expect(page.getByRole('button', { name: '검사정보 챗봇 열기' })).toBeVisible();
  await page.getByRole('button', { name: '검사정보 챗봇 열기' }).click();
  await expect(page.getByRole('heading', { name: 'SCL 검사정보 AI 도우미' })).toBeVisible();
});

test('질문 전송 후 loading, 검사정보, 출처, 이미지와 PDF를 표시한다', async ({ page }) => {
  await mockResourceFiles(page);
  let submittedQuestion = '';
  await page.route('**/api/chatbot/interpret', async (route) => {
    submittedQuestion = route.request().postDataJSON().question;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({ status: 200, contentType: 'application/json', json: SUCCESS_RESPONSE });
  });
  await page.goto('/');

  const input = page.getByLabel('검사정보 질문');
  await input.fill('ALT 검사 결과는 며칠 걸려?');
  await input.press('Enter');

  await expect(page.getByText('공식 자료를 확인하고 있어요')).toBeVisible();
  await expect(page.getByRole('button', { name: '질문 전송' })).toBeDisabled();
  await expect(page.getByText(SUCCESS_RESPONSE.answer)).toHaveCount(0);
  expect(submittedQuestion).toBe('ALT 검사 결과는 며칠 걸려?');

  const testCard = page.locator('.test-card');
  await expect(testCard).toContainText('ALT');
  await expect(testCard).toContainText('10130');
  await expect(testCard).toContainText('Serum');
  await expect(testCard).toContainText('Enzymatic method');
  await expect(testCard).toContainText('1일');
  await expect(testCard.locator('.test-card__time-type')).toHaveClass(/test-card__time-type--night/);
  await expect(testCard.locator('.schedule-day')).toHaveCount(7);
  await expect(testCard.getByLabel('토요일 검사함')).toHaveClass(/is-active/);
  await expect(testCard.getByLabel('일요일 검사 없음')).not.toHaveClass(/is-active/);
  await expect(testCard.locator('.schedule-legend')).toContainText('검사일');
  await expect(testCard.locator('.schedule-legend')).toContainText('미검사');

  const source = page.getByRole('link', { name: /ALT 검사정보/ });
  await expect(source).toHaveAttribute('href', SOURCE_URL);
  await expect(source).toHaveAttribute('target', '_blank');

  await expect(page.getByRole('img', { name: 'Serum 용기' })).toBeVisible();
  await expect(page.getByRole('link', { name: /검사의뢰서/ })).toHaveAttribute('href', PDF_URL);
  await expect.poll(() => page.locator('.chatbot__conversation').evaluate(
    (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
  )).toBeLessThanOrEqual(2);
});

test('Shift+Enter는 줄바꿈하고 Enter는 질문을 전송한다', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/chatbot/interpret', async (route) => {
    calls += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', json: SUCCESS_RESPONSE });
  });
  await page.goto('/');
  const input = page.getByLabel('검사정보 질문');
  await input.fill('ALT 검사');
  await input.press('Shift+Enter');
  await input.type('검체는?');
  await expect(input).toHaveValue('ALT 검사\n검체는?');
  expect(calls).toBe(0);

  await input.press('Enter');
  await expect(page.locator('.test-card')).toContainText('ALT');
  expect(calls).toBe(1);
});

test('범위 밖 질문은 출처 카드 없이 안내한다', async ({ page }) => {
  await page.route('**/api/chatbot/interpret', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      answer: 'SCL 공개 검사정보에서 질문과 관련된 정보를 찾지 못했습니다.',
      grounded: false,
      matchedTests: [],
      sources: [],
      resources: [],
    },
  }));
  await page.goto('/');
  await page.getByLabel('검사정보 질문').fill('오늘 날씨 알려줘');
  await page.getByRole('button', { name: '질문 전송' }).click();

  await expect(page.getByText('SCL 공개 검사정보에서 질문과 관련된 정보를 찾지 못했습니다.')).toBeVisible();
  await expect(page.locator('.result-panel')).toHaveCount(0);
});

test('의미 검색은 찾은 개수 문구 없이 검사 결과 카드만 표시한다', async ({ page }) => {
  await page.route('**/api/chatbot/interpret', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: { ...SUCCESS_RESPONSE, answer: '관련 검사정보를 확인했습니다.', retrievalPath: 'VECTOR', presentation: 'RESULTS_ONLY' },
  }));
  await page.goto('/');
  await page.getByLabel('검사정보 질문').fill('간 기능 관련 검사');
  await page.getByRole('button', { name: '질문 전송' }).click();

  await expect(page.getByText('관련 검사정보를 확인했습니다.')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '검사 결과' })).toBeVisible();
  await expect(page.locator('.test-card')).toContainText('ALT');
});

test('급여·비급여 코드 검색 결과를 검사 카드로 표시한다', async ({ page }) => {
  let submittedQuestion = '';
  await page.route('**/api/chatbot/interpret', async (route) => {
    submittedQuestion = route.request().postDataJSON().question;
    await route.fulfill({ status: 200, contentType: 'application/json', json: SUCCESS_RESPONSE });
  });
  await page.goto('/');
  await page.getByLabel('검사정보 질문').fill('급여코드 D185000HZ인 검사 알려줘');
  await page.getByRole('button', { name: '질문 전송' }).click();

  expect(submittedQuestion).toBe('급여코드 D185000HZ인 검사 알려줘');
  await expect(page.locator('.test-card')).toContainText('ALT');
  await expect(page.locator('.test-card')).toContainText('D185000HZ');
});

test('범주가 넓은 질문은 임의 결과 대신 구체적인 검사명이나 코드를 요청한다', async ({ page }) => {
  await page.route('**/api/chatbot/interpret', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      answer: "'특검'에 해당할 수 있는 검사 항목이 여러 개 있어 하나로 특정하기 어렵습니다. 찾으시는 검사명 일부를 더 입력하거나 검사코드를 알려주세요.",
      grounded: false,
      matchedTests: [],
      sources: [],
      resources: [],
      retrievalPath: 'CLARIFICATION',
    },
  }));
  await page.goto('/');
  await page.getByLabel('검사정보 질문').fill('특검 검사');
  await page.getByRole('button', { name: '질문 전송' }).click();

  await expect(page.getByText(/검사 항목이 여러 개/)).toBeVisible();
  await expect(page.locator('.test-card')).toHaveCount(0);
});

test('줄바꿈과 불릿이 포함된 AI 답변을 항목별로 표시한다', async ({ page }) => {
  await page.route('**/api/chatbot/interpret', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      answer: 'ALT 검사정보입니다. • 검체 — Serum • 소요일 — 1일',
      grounded: false,
      matchedTests: [],
      sources: [],
      resources: [],
    },
  }));
  await page.goto('/');
  await page.getByLabel('검사정보 질문').fill('ALT 요약해줘');
  await page.getByRole('button', { name: '질문 전송' }).click();

  const answer = page.getByTestId('message-assistant').last().locator('.message__text');
  await expect(answer.locator('.answer-line')).toHaveCount(3);
  await expect(answer.locator('.answer-line--bullet')).toHaveCount(2);
  await expect(answer).toContainText('검체 — Serum');
});

test('API 오류를 표시하고 같은 질문을 다시 시도한다', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/chatbot/interpret', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        json: { error: { code: 'GENERATION_UNAVAILABLE', message: '생성 서비스 준비 중', requestId: 'e2e-1' } },
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', json: SUCCESS_RESPONSE });
  });
  await page.goto('/');
  await page.getByLabel('검사정보 질문').fill('10130 검사 알려줘');
  await page.getByRole('button', { name: '질문 전송' }).click();

  await expect(page.getByText('현재 AI 답변 기능이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.')).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.locator('.test-card')).toContainText('ALT');
  await expect(page.getByTestId('message-user')).toHaveCount(1);
  expect(calls).toBe(2);
});

test('degraded health 상태를 사용자에게 표시한다', async ({ page }) => {
  await page.unroute('**/api/health');
  await mockHealth(page, 'degraded');
  await page.goto('/');
  await expect(page.getByText('일부 검색 기능 점검 필요')).toBeVisible();
});
