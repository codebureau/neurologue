'use strict';

const { kmeans, cosineSimilarity } = require('../../../src/backend/clustering/kmeans');

// ── Helpers ────────────────────────────────────────────────────────────────

function vec(...values) { return new Float32Array(values); }

// Generate n random vectors of given dim using a seeded PRNG
function syntheticVectors(n, dim, seed = 1) {
  let s = seed >>> 0;
  function rand() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  }
  return Array.from({ length: n }, () => new Float32Array(Array.from({ length: dim }, rand)));
}

// ── kmeans ─────────────────────────────────────────────────────────────────

describe('kmeans', () => {
  test('returns empty result for empty input', () => {
    const { assignments, centroids, iterations } = kmeans([], 3);
    expect(assignments).toEqual([]);
    expect(centroids).toEqual([]);
    expect(iterations).toBe(0);
  });

  test('handles k > n by clamping k to n', () => {
    const vecs = [vec(1, 0), vec(0, 1)];
    const { assignments, centroids } = kmeans(vecs, 10);
    expect(centroids.length).toBeLessThanOrEqual(vecs.length);
    expect(assignments).toHaveLength(vecs.length);
  });

  test('assigns each vector to exactly one cluster', () => {
    const vecs = syntheticVectors(20, 4);
    const { assignments } = kmeans(vecs, 3);
    expect(assignments).toHaveLength(20);
    assignments.forEach((a) => {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(3);
    });
  });

  test('returns the correct number of centroids', () => {
    const vecs = syntheticVectors(30, 8);
    const { centroids } = kmeans(vecs, 4);
    expect(centroids).toHaveLength(4);
    centroids.forEach((c) => expect(c).toHaveLength(8));
  });

  test('clearly separable clusters are correctly separated', () => {
    // Two tight clusters far apart in 2D space
    const cluster0 = Array.from({ length: 10 }, (_, i) =>
      vec(0.01 * i, 0.01 * i));
    const cluster1 = Array.from({ length: 10 }, (_, i) =>
      vec(10 + 0.01 * i, 10 + 0.01 * i));
    const vecs = [...cluster0, ...cluster1];

    const { assignments } = kmeans(vecs, 2);

    // All first 10 should share a cluster; all last 10 should share a different one
    const group0 = new Set(assignments.slice(0, 10));
    const group1 = new Set(assignments.slice(10, 20));
    expect(group0.size).toBe(1);
    expect(group1.size).toBe(1);
    expect([...group0][0]).not.toBe([...group1][0]);
  });

  test('is deterministic for the same seed', () => {
    const vecs = syntheticVectors(20, 4, 99);
    const r1 = kmeans(vecs, 3, { seed: 7 });
    const r2 = kmeans(vecs, 3, { seed: 7 });
    expect(r1.assignments).toEqual(r2.assignments);
  });

  test('different seeds may produce different assignments', () => {
    const vecs = syntheticVectors(30, 8, 55);
    const r1 = kmeans(vecs, 5, { seed: 1 });
    const r2 = kmeans(vecs, 5, { seed: 999 });
    // Not guaranteed to differ, but with random data they almost certainly will
    const same = r1.assignments.every((a, i) => a === r2.assignments[i]);
    // This is a soft check — just ensure both runs complete without error
    expect(r1.assignments).toHaveLength(30);
    expect(r2.assignments).toHaveLength(30);
    void same; // acceptable either way
  });

  test('respects maxIter', () => {
    const vecs = syntheticVectors(20, 4);
    const { iterations } = kmeans(vecs, 3, { maxIter: 2 });
    // iter is 0-based; loop runs at most maxIter times → iterations <= maxIter
    expect(iterations).toBeLessThanOrEqual(2);
  });
});

// ── cosineSimilarity ────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  test('identical vectors have similarity 1', () => {
    const v = vec(1, 2, 3, 4);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  test('opposite vectors have similarity -1', () => {
    const v = vec(1, 0, 0);
    const w = vec(-1, 0, 0);
    expect(cosineSimilarity(v, w)).toBeCloseTo(-1, 5);
  });

  test('orthogonal vectors have similarity 0', () => {
    const v = vec(1, 0);
    const w = vec(0, 1);
    expect(cosineSimilarity(v, w)).toBeCloseTo(0, 5);
  });

  test('zero vector returns 0 without throwing', () => {
    const v = vec(0, 0, 0);
    const w = vec(1, 2, 3);
    expect(cosineSimilarity(v, w)).toBe(0);
  });

  test('values are in range [-1, 1]', () => {
    const vecs = syntheticVectors(10, 8);
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        const sim = cosineSimilarity(vecs[i], vecs[j]);
        expect(sim).toBeGreaterThanOrEqual(-1 - 1e-9);
        expect(sim).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
