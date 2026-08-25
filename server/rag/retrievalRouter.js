export const RETRIEVAL_PATHS = Object.freeze({
  EXACT: 'EXACT',
  STRUCTURED: 'STRUCTURED',
  COMPARISON: 'COMPARISON',
  VECTOR: 'VECTOR',
  NO_RESULT: 'NO_RESULT',
});

function exactPath(analysis) {
  if (analysis.intent === 'COMPARISON') return RETRIEVAL_PATHS.COMPARISON;
  if (analysis.intent === 'FIELD_LOOKUP' || analysis.intent === 'RESOURCE_REQUEST') return RETRIEVAL_PATHS.STRUCTURED;
  return RETRIEVAL_PATHS.EXACT;
}

export class RetrievalRouter {
  constructor({ store, embeddingService, metrics, topK = process.env.RAG_TOP_K || 5, minScore = process.env.RAG_MIN_SCORE || process.env.RAG_MIN_SIMILARITY || 0.6 }) {
    if (!store) throw new Error('Qdrant store가 필요합니다.');
    this.store = store;
    this.embeddingService = embeddingService;
    this.metrics = metrics;
    this.topK = Number(topK);
    this.minScore = Number(minScore);
    if (!Number.isSafeInteger(this.topK) || this.topK <= 0) throw new Error('RAG_TOP_K가 올바르지 않습니다.');
    if (!Number.isFinite(this.minScore) || this.minScore < -1 || this.minScore > 1) throw new Error('RAG_MIN_SCORE가 올바르지 않습니다.');
  }

  async retrieve(analysis) {
    if (analysis.entity.testCodes.length > 0) {
      const documents = await this.store.findByTestCodes(analysis.entity.testCodes);
      return { path: documents.length ? exactPath(analysis) : RETRIEVAL_PATHS.NO_RESULT, documents };
    }

    if (analysis.entity.testName) {
      const exactDocuments = await this.store.findByExactName(analysis.entity.testName);
      if (exactDocuments.length > 0) return { path: exactPath(analysis), documents: exactDocuments };
    }

    if (!this.embeddingService) {
      const error = new Error('의미 검색에 필요한 Gemini Embedding 설정을 사용할 수 없습니다.');
      error.statusCode = 503;
      error.code = 'SEMANTIC_SEARCH_UNAVAILABLE';
      throw error;
    }
    this.metrics?.increment('embeddingCalls');
    const vector = await this.embeddingService.embedQuery(analysis.original);
    const documents = await this.store.semanticSearch(vector, { topK: this.topK, minScore: this.minScore });
    return { path: documents.length ? RETRIEVAL_PATHS.VECTOR : RETRIEVAL_PATHS.NO_RESULT, documents };
  }
}
