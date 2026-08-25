import assert from 'node:assert/strict';
import test from 'node:test';
import healthHandler from '../api/health.js';
import statsHandler from '../api/stats.js';
import chatbotHandler, { config as chatbotConfig } from '../api/chatbot/interpret.js';

test('Vercel Node Functions entrypoint를 모두 export한다', () => {
  assert.equal(typeof healthHandler, 'function');
  assert.equal(typeof statsHandler, 'function');
  assert.equal(typeof chatbotHandler, 'function');
  assert.equal(chatbotConfig.maxDuration, 30);
});
