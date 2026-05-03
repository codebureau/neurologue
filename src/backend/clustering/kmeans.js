'use strict';

/**
 * Pure-JS k-means clustering over Float32Array vectors.
 * No native dependencies — runs in the main Node process.
 *
 * @param {Float32Array[]} vectors   - Array of equal-length embedding vectors
 * @param {number}         k         - Number of clusters
 * @param {object}         [opts]
 * @param {number}         [opts.maxIter=100]   - Maximum iterations
 * @param {number}         [opts.tol=1e-6]      - Convergence tolerance (centroid shift)
 * @param {number}         [opts.seed=42]       - PRNG seed for initial centroid selection
 * @returns {{ assignments: number[], centroids: Float32Array[], iterations: number }}
 */
function kmeans(vectors, k, { maxIter = 100, tol = 1e-6, seed = 42 } = {}) {
  if (vectors.length === 0) return { assignments: [], centroids: [], iterations: 0 };
  k = Math.min(k, vectors.length);
  const dim = vectors[0].length;
  const n = vectors.length;

  // ── Seeded PRNG (mulberry32) ─────────────────────────────────────────────
  let s = seed >>> 0;
  function rand() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ── k-means++ initialisation ─────────────────────────────────────────────
  const centroids = [];
  const firstIdx = Math.floor(rand() * n);
  centroids.push(new Float32Array(vectors[firstIdx]));

  for (let c = 1; c < k; c++) {
    const dists = vectors.map((v) => {
      let minD = Infinity;
      for (const cent of centroids) {
        const d = squaredDist(v, cent, dim);
        if (d < minD) minD = d;
      }
      return minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { chosen = i; break; }
    }
    centroids.push(new Float32Array(vectors[chosen]));
  }

  // ── Iterate ──────────────────────────────────────────────────────────────
  let assignments = new Array(n).fill(0);
  let iter = 0;

  for (; iter < maxIter; iter++) {
    // Assignment step
    const newAssignments = vectors.map((v) => {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = squaredDist(v, centroids[c], dim);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    });

    // Update step — recompute centroids
    const sums = Array.from({ length: k }, () => new Float64Array(dim));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = newAssignments[i];
      counts[c]++;
      for (let d = 0; d < dim; d++) sums[c][d] += vectors[i][d];
    }

    let maxShift = 0;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue; // keep old centroid for empty cluster
      const newCent = new Float32Array(dim);
      for (let d = 0; d < dim; d++) newCent[d] = sums[c][d] / counts[c];
      maxShift = Math.max(maxShift, squaredDist(centroids[c], newCent, dim));
      centroids[c] = newCent;
    }

    assignments = newAssignments;
    if (maxShift < tol * tol) break;
  }

  return { assignments, centroids, iterations: iter };
}

/**
 * Compute cosine similarity between two Float32Array vectors.
 * Returns a value in [-1, 1]; higher = more similar.
 */
function cosineSimilarity(a, b) {
  const dim = a.length;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < dim; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function squaredDist(a, b, dim) {
  let s = 0;
  for (let i = 0; i < dim; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

module.exports = { kmeans, cosineSimilarity };
