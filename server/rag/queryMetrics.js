import { performance } from 'node:perf_hooks';

const COUNTERS = [
  'totalQueries', 'exactQueries', 'structuredQueries', 'comparisonQueries', 'vectorQueries',
  'embeddingCalls', 'generationCalls', 'blockedMedicalQueries', 'noResultQueries',
];

export class QueryMetrics {
  constructor() {
    this.counters = Object.fromEntries(COUNTERS.map((name) => [name, 0]));
    this.latencies = { EXACT: [], STRUCTURED: [], COMPARISON: [], VECTOR: [], BLOCKED: [], NO_RESULT: [] };
  }

  increment(name, amount = 1) {
    if (!(name in this.counters)) throw new Error(`알 수 없는 통계 카운터입니다: ${name}`);
    this.counters[name] += amount;
  }

  startTimer() {
    return performance.now();
  }

  recordLatency(route, startedAt) {
    const bucket = this.latencies[route] ?? (this.latencies[route] = []);
    bucket.push(performance.now() - startedAt);
    if (bucket.length > 1000) bucket.shift();
  }

  snapshot() {
    const total = this.counters.totalQueries;
    const averageLatencyMs = Object.fromEntries(Object.entries(this.latencies).map(([route, values]) => [
      route,
      values.length === 0 ? null : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
    ]));
    return {
      ...this.counters,
      embeddingBypassRate: total === 0 ? null : Number((((total - this.counters.embeddingCalls) / total) * 100).toFixed(2)),
      generationBypassRate: total === 0 ? null : Number((((total - this.counters.generationCalls) / total) * 100).toFixed(2)),
      averageLatencyMs,
      samples: Object.fromEntries(Object.entries(this.latencies).map(([route, values]) => [route, values.length])),
    };
  }
}
