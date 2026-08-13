import { loadEnvironment } from '../server/loadEnvironment.js';
import { GeminiEmbeddingService } from '../server/rag/embeddingService.js';
import { loadRetrievalService } from '../server/rag/retrievalService.js';

loadEnvironment();

const queries = process.argv.slice(2).length > 0
  ? [process.argv.slice(2).join(' ')]
  : ['10130 검사 정보 알려줘', 'ALT 검사 결과는 며칠 걸려?', '(특검)ALT 알려줘'];

const apiKey = process.env.GEMINI_API_KEY?.trim();
const configuredMinimum = process.env.RAG_MIN_SIMILARITY;
const similarityEvaluated = configuredMinimum !== undefined && configuredMinimum !== '';
const embeddingService = apiKey ? new GeminiEmbeddingService({ apiKey }) : null;
const service = await loadRetrievalService({
  embeddingService,
  minSimilarity: similarityEvaluated ? configuredMinimum : -1,
});
console.log(`Semantic search: ${service.semanticAvailable ? 'available' : 'unavailable (API key or vector index missing)'}`);
if (service.semanticAvailable && !similarityEvaluated) {
  console.log('Similarity filter: disabled for evaluation (set RAG_MIN_SIMILARITY before production use)');
}

for (const query of queries) {
  const results = await service.search(query, { topK: 5 });
  console.log(`\nQuery: ${query}`);
  for (const [index, result] of results.entries()) {
    const similarity = result.retrieval.similarity === null
      ? 'n/a'
      : result.retrieval.similarity.toFixed(4);
    console.log(`${index + 1}. ${result.testCode} | ${result.testName} | ${result.specimen} | score=${result.retrieval.score.toFixed(3)} | similarity=${similarity} | ${result.retrieval.matchReasons.join(',')}`);
  }
}
