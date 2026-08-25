import { QdrantClient } from '@qdrant/js-client-rest';
import { normalizeTestName } from './contentIdentity.js';

const DEFAULT_INDEX_FIELDS = Object.freeze([
  ['id', 'keyword'],
  ['testCode', 'keyword'],
  ['sampleCode', 'keyword'],
  ['normalizedTestName', 'keyword'],
  ['contentHash', 'keyword'],
  ['active', 'bool'],
]);

function activeFilter(extraMust = []) {
  return { must: [{ key: 'active', match: { value: true } }, ...extraMust] };
}

function payloadFromPoint(point, score = null) {
  return point?.payload ? {
    ...point.payload,
    qdrantPointId: point.id,
    retrieval: score === null ? undefined : {
      score,
      similarity: score,
      matchReasons: ['semantic'],
    },
  } : null;
}

export class QdrantStore {
  constructor({
    url = process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey = process.env.QDRANT_API_KEY,
    collection = process.env.QDRANT_COLLECTION || 'scl_tests',
    dimension = process.env.GEMINI_EMBEDDING_DIMENSION || 768,
    client,
  } = {}) {
    const parsedDimension = Number(dimension);
    if (!Number.isSafeInteger(parsedDimension) || parsedDimension <= 0) throw new Error('Qdrant vector dimension이 올바르지 않습니다.');
    this.url = url;
    this.collection = collection;
    this.dimension = parsedDimension;
    this.client = client ?? new QdrantClient({ url, apiKey: apiKey?.trim() || undefined, checkCompatibility: false });
  }

  async health() {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((item) => item.name === this.collection);
      let info = null;
      if (exists) info = await this.client.getCollection(this.collection);
      return {
        connected: true,
        collectionExists: exists,
        collection: this.collection,
        pointCount: Number(info?.points_count ?? 0),
        dimension: this.dimension,
      };
    } catch (error) {
      return {
        connected: false,
        collectionExists: false,
        collection: this.collection,
        pointCount: 0,
        dimension: this.dimension,
        error: error.message,
      };
    }
  }

  async ensureCollection() {
    const health = await this.health();
    if (!health.connected) throw new Error(`Qdrant에 연결할 수 없습니다: ${health.error}`);
    if (!health.collectionExists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.dimension, distance: 'Cosine' },
        on_disk_payload: true,
      });
    } else {
      const info = await this.client.getCollection(this.collection);
      const configuredSize = Number(info?.config?.params?.vectors?.size ?? this.dimension);
      if (configuredSize !== this.dimension) {
        throw new Error(`Qdrant collection 차원이 다릅니다. 기대값 ${this.dimension}, 실제값 ${configuredSize}`);
      }
    }

    for (const [fieldName, fieldSchema] of DEFAULT_INDEX_FIELDS) {
      try {
        await this.client.createPayloadIndex(this.collection, { field_name: fieldName, field_schema: fieldSchema, wait: true });
      } catch (error) {
        if (!/already exists|already indexed/iu.test(error.message)) throw error;
      }
    }
    return this.health();
  }

  async #scroll(filter, { limit = 100, withVector = false } = {}) {
    const points = [];
    let offset;
    do {
      const page = await this.client.scroll(this.collection, {
        filter,
        limit,
        offset,
        with_payload: true,
        with_vector: withVector,
      });
      points.push(...page.points);
      offset = page.next_page_offset ?? null;
    } while (offset !== null && offset !== undefined);
    return points;
  }

  async findByTestCodes(testCodes) {
    const uniqueCodes = [...new Set(testCodes.map(String))];
    if (uniqueCodes.length === 0) return [];
    const points = await this.#scroll(activeFilter([{ key: 'testCode', match: { any: uniqueCodes } }]));
    return points.map((point) => payloadFromPoint(point)).filter(Boolean);
  }

  async findByExactName(testName) {
    const normalizedName = normalizeTestName(testName);
    if (!normalizedName) return [];
    const points = await this.#scroll(activeFilter([{ key: 'normalizedTestName', match: { value: normalizedName } }]));
    return points.map((point) => payloadFromPoint(point)).filter(Boolean);
  }

  async semanticSearch(vector, { topK = 5, minScore = 0.6 } = {}) {
    const result = await this.client.query(this.collection, {
      query: vector,
      limit: topK,
      score_threshold: minScore,
      filter: activeFilter(),
      with_payload: true,
      with_vector: false,
    });
    return (result.points ?? []).map((point) => payloadFromPoint(point, point.score)).filter(Boolean);
  }

  async listAll({ withVector = false } = {}) {
    return this.#scroll(undefined, { withVector });
  }

  async upsert(points) {
    if (points.length === 0) return;
    await this.client.upsert(this.collection, { wait: true, points });
  }

  async updatePayload(pointId, payload) {
    await this.client.setPayload(this.collection, { wait: true, points: [pointId], payload });
  }

  async deactivate(pointIds, updatedAt = new Date().toISOString()) {
    if (pointIds.length === 0) return;
    await this.client.setPayload(this.collection, {
      wait: true,
      points: pointIds,
      payload: { active: false, updatedAt },
    });
  }
}
