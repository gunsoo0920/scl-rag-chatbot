import { performance } from 'node:perf_hooks';

const baseUrl = String(process.env.CHATBOT_BENCHMARK_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const iterations = Number(process.env.CHATBOT_BENCHMARK_ITERATIONS || 3);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) throw new Error('CHATBOT_BENCHMARK_ITERATIONS는 1-100이어야 합니다.');

const scenarios = [
  ['EXACT', '16290 검사 알려줘'],
  ['STRUCTURED', '16290 검사 며칠 걸려?'],
  ['COMPARISON', '16290이랑 11380 중 뭐가 빨라?'],
  ['VECTOR', '파브리병 관련 검사 알려줘'],
];
const results = [];
for (const [expectedPath, question] of scenarios) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}/api/chatbot/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
    if (payload.retrievalPath !== expectedPath) throw new Error(`${question}: 기대 경로 ${expectedPath}, 실제 ${payload.retrievalPath}`);
    samples.push(performance.now() - startedAt);
  }
  results.push({
    path: expectedPath,
    iterations,
    averageMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
    minimumMs: Number(Math.min(...samples).toFixed(3)),
    maximumMs: Number(Math.max(...samples).toFixed(3)),
  });
}
const stats = await fetch(`${baseUrl}/api/stats`).then((response) => response.json());
console.log(JSON.stringify({ results, aiCalls: { embeddingCalls: stats.embeddingCalls, generationCalls: stats.generationCalls } }, null, 2));
