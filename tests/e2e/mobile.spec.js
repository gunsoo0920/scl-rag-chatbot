import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    json: {
      status: 'degraded',
      services: {
        generationAvailable: false,
        semanticSearchAvailable: false,
        vectorIndexAvailable: false,
        knowledgeDocuments: 3327,
      },
    },
  }));
});

test('모바일 화면에서 주요 컨트롤이 보이고 가로 스크롤이 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SCL 검사정보 AI 도우미' })).toBeVisible();
  await expect(page.getByLabel('검사정보 질문')).toBeVisible();
  await expect(page.getByRole('button', { name: '질문 전송' })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
