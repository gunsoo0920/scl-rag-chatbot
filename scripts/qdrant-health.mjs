import { loadEnvironment } from '../server/loadEnvironment.js';
import { QdrantStore } from '../server/rag/qdrantStore.js';

loadEnvironment();
const store = new QdrantStore();
const health = await store.health();
console.log(JSON.stringify(health, null, 2));
if (!health.connected || !health.collectionExists) process.exitCode = 1;
