import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment } from '../server/loadEnvironment.js';
import { QdrantStore } from '../server/rag/qdrantStore.js';

const integrationTest = process.env.RUN_QDRANT_INTEGRATION === 'true' ? test : test.skip;

integrationTest('실제 Qdrant collection과 payload exact lookup을 검증한다', async () => {
  loadEnvironment();
  const store = new QdrantStore();
  const health = await store.health();
  assert.equal(health.connected, true);
  assert.equal(health.collectionExists, true);
  assert.equal(health.dimension, 768);
  assert.ok(health.pointCount >= 3000);

  const documents = await store.findByTestCodes(['16290', '11380']);
  assert.equal(documents.filter((document) => document.testCode === '16290').length, 1);
  assert.equal(documents.filter((document) => document.testCode === '11380').length, 2);
  assert.equal(documents.find((document) => document.testCode === '16290').turnaroundTime, '5일');
});
