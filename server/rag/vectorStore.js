import { readFile } from 'node:fs/promises';

function assertFiniteVector(vector, label) {
  if (!Array.isArray(vector) || vector.length === 0) throw new Error(`${label} 벡터가 비어 있습니다.`);
  if (vector.some((value) => !Number.isFinite(value))) throw new Error(`${label} 벡터에 유한하지 않은 값이 있습니다.`);
}

export function vectorMagnitude(vector) {
  assertFiniteVector(vector, '입력');
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

export function cosineSimilarity(left, right) {
  assertFiniteVector(left, '첫 번째');
  assertFiniteVector(right, '두 번째');
  if (left.length !== right.length) {
    throw new Error(`벡터 차원이 일치하지 않습니다. ${left.length} != ${right.length}`);
  }

  let dotProduct = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftSquared += left[index] ** 2;
    rightSquared += right[index] ** 2;
  }
  if (leftSquared === 0 || rightSquared === 0) throw new Error('영벡터의 cosine similarity는 계산할 수 없습니다.');
  return dotProduct / Math.sqrt(leftSquared * rightSquared);
}

export function validateVectorIndex(index, { expectedDocumentIds } = {}) {
  const errors = [];
  const dimension = index?.dimension;
  const vectors = index?.vectors;

  if (index?.version !== 1) errors.push('version은 1이어야 합니다.');
  if (!index?.model) errors.push('model이 비어 있습니다.');
  if (!Number.isSafeInteger(dimension) || dimension <= 0) errors.push('dimension이 올바르지 않습니다.');
  if (index?.normalized !== true) errors.push('normalized가 true가 아닙니다.');
  if (!Array.isArray(vectors)) errors.push('vectors가 배열이 아닙니다.');

  if (Array.isArray(vectors)) {
    if (index.documentCount !== vectors.length) errors.push('documentCount와 vectors 수가 다릅니다.');
    const ids = new Set();
    for (const [position, entry] of vectors.entries()) {
      if (!entry?.id) errors.push(`vectors[${position}].id가 비어 있습니다.`);
      else if (ids.has(entry.id)) errors.push(`중복 vector id: ${entry.id}`);
      else ids.add(entry.id);

      if (!Array.isArray(entry?.values) || entry.values.length !== dimension) {
        errors.push(`vectors[${position}] 차원 오류`);
        continue;
      }
      if (entry.values.some((value) => !Number.isFinite(value))) {
        errors.push(`vectors[${position}]에 유한하지 않은 값이 있습니다.`);
        continue;
      }
      const norm = Math.sqrt(entry.values.reduce((sum, value) => sum + value * value, 0));
      if (Math.abs(norm - 1) > 1e-5) errors.push(`vectors[${position}] 정규화 오류: ${norm}`);
    }

    if (expectedDocumentIds) {
      const expected = new Set(expectedDocumentIds);
      for (const id of expected) if (!ids.has(id)) errors.push(`누락된 vector id: ${id}`);
      for (const id of ids) if (!expected.has(id)) errors.push(`알 수 없는 vector id: ${id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function searchVectorIndex(index, queryVector, { topK = 5, minSimilarity = 0 } = {}) {
  const validation = validateVectorIndex(index);
  if (!validation.valid) throw new Error(`유효하지 않은 vector index: ${validation.errors[0]}`);
  assertFiniteVector(queryVector, '질의');
  if (queryVector.length !== index.dimension) {
    throw new Error(`질의 벡터 차원이 올바르지 않습니다. 기대값 ${index.dimension}, 실제값 ${queryVector.length}`);
  }
  if (!Number.isSafeInteger(topK) || topK <= 0) throw new Error('topK는 양의 정수여야 합니다.');
  if (!Number.isFinite(minSimilarity) || minSimilarity < -1 || minSimilarity > 1) {
    throw new Error('minSimilarity는 -1 이상 1 이하여야 합니다.');
  }

  return index.vectors
    .map((entry) => ({ ...entry, similarity: cosineSimilarity(queryVector, entry.values) }))
    .filter((entry) => entry.similarity >= minSimilarity)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, topK);
}

export async function loadVectorIndex(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
