/**
 * Pairing engine — pure functions.
 *
 * Given the set of present players, this season's prior pairs, and this
 * season's prior byes, `computePairing` returns a maximum matching that:
 *
 *   1. Avoids prior pairs whenever a full covering is possible (no repeats).
 *   2. Selects the least-recently-benched player for the bye when the present
 *      count is odd.
 *   3. Falls back to progressively re-admitting prior pairs (oldest first) when
 *      no all-fresh covering matching exists, setting `usedFallback = true`.
 *
 * Maximum matching is computed via an exact backtracking search that is
 * correct on all general (non-bipartite) graphs. The active roster is at most
 * ~26 players (weekly present sets are smaller still), making backtracking
 * fast in practice while guaranteeing a true maximum matching.
 *
 * No I/O, no JSX, no side effects. All inputs are treated as read-only.
 */

import type { PairingInput, PairingResult, PriorPair } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel used in the matching array to mark an unmatched vertex. */
const UNMATCHED = -1;

/**
 * Sentinel sort key for never-benched players in the bye-selection sort.
 * -Infinity guarantees a never-benched player sorts strictly before any
 * player with a finite (recorded) weekIndex.
 */
const NEVER_BENCHED_SORT_KEY = -Infinity;

// ---------------------------------------------------------------------------
// Internal graph types
// ---------------------------------------------------------------------------

/**
 * An adjacency-list graph over integer vertex indices 0..n-1.
 * Each entry `adj[u]` is the list of neighbours of vertex u.
 */
type Graph = number[][];

/**
 * Canonical string key for an undirected edge {u, v}, ordering the endpoints so
 * that {u, v} and {v, u} map to the same key. Used to dedupe/look up edges in a
 * Set regardless of the order the endpoints are supplied.
 */
const edgeKey = (u: number, v: number): string =>
  u < v ? `${u}-${v}` : `${v}-${u}`;

// ---------------------------------------------------------------------------
// Graph construction helpers
// ---------------------------------------------------------------------------

/**
 * Builds a complete graph on `n` vertices, represented as an adjacency list.
 * Vertices are integers 0..n-1.
 */
const buildCompleteGraph = (n: number): Graph => {
  const adj: Graph = Array.from({ length: n }, () => []);
  for (let u = 0; u < n; u += 1) {
    for (let v = u + 1; v < n; v += 1) {
      adj[u].push(v);
      adj[v].push(u);
    }
  }
  return adj;
};

/**
 * Removes all forbidden edges from the adjacency list. Returns a new graph —
 * does not mutate the input.
 *
 * @param forbiddenEdges - pairs of vertex indices whose edges to remove.
 */
const removeEdges = (
  adj: Graph,
  forbiddenEdges: [number, number][],
): Graph => {
  const forbidden = new Set<string>(
    forbiddenEdges.map(([u, v]) => edgeKey(u, v)),
  );
  return adj.map((neighbours, u) =>
    neighbours.filter((v) => !forbidden.has(edgeKey(u, v))),
  );
};

// ---------------------------------------------------------------------------
// Maximum matching — exact backtracking for general graphs
// ---------------------------------------------------------------------------
//
// This implementation uses a greedy backtracking search that is correct on
// all general (non-bipartite) graphs. It scans vertices in order and tries
// to match each unmatched vertex with each unmatched allowed partner. On
// finding a perfect matching it returns immediately (early exit). Otherwise
// it tracks the best matching found and returns it.
//
// Complexity: exponential worst-case, but for the small roster sizes used
// here (at most ~26 present players) this is fast in practice because:
//   - Perfect matchings are found and returned early.
//   - The ordered scan reduces the search space significantly.
//   - Typical present-set sizes are 6-14 players.
// ---------------------------------------------------------------------------

/**
 * Computes a maximum matching on `adj` via exact backtracking.
 *
 * Returns a `mate` array where `mate[u]` is the index of u's matched
 * partner, or UNMATCHED (-1) if u is unmatched.
 *
 * The algorithm scans vertices 0..n-1 in order and for each unmatched
 * vertex u tries:
 *   (a) matching u with each unmatched neighbour v > u, then recurse;
 *   (b) leaving u unmatched and continuing.
 * The best result across all branches is returned.
 */
const maximumMatching = (adj: Graph): number[] => {
  const n = adj.length;

  // Perfect matching size: n/2 for even n, (n-1)/2 for odd n.
  const targetSize = Math.floor(n / 2);

  const mate = new Array<number>(n).fill(UNMATCHED);
  const matched = new Array<boolean>(n).fill(false);

  // Best matching found so far.
  let bestSize = 0;
  const bestMate = new Array<number>(n).fill(UNMATCHED);

  /**
   * Backtracking search. `startVertex` is the lowest vertex index not yet
   * considered for a new match. `currentSize` is the number of pairs matched.
   */
  const backtrack = (startVertex: number, currentSize: number): void => {
    if (currentSize > bestSize) {
      bestSize = currentSize;
      for (let i = 0; i < n; i += 1) bestMate[i] = mate[i];
    }

    // Early exit: perfect (or near-perfect for odd n) matching found.
    if (currentSize === targetSize) return;

    // Find the next unmatched vertex at or after startVertex.
    let u = startVertex;
    while (u < n && matched[u]) u += 1;
    if (u >= n) return;

    // Branch 1: try matching u with each unmatched neighbour v > u.
    // (Restricting to v > u avoids counting each pair twice.)
    for (const v of adj[u]) {
      if (v <= u || matched[v]) continue;

      matched[u] = true;
      matched[v] = true;
      mate[u] = v;
      mate[v] = u;

      backtrack(u + 1, currentSize + 1);

      matched[u] = false;
      matched[v] = false;
      mate[u] = UNMATCHED;
      mate[v] = UNMATCHED;

      // Early exit propagation once the perfect matching is confirmed.
      if (bestSize === targetSize) return;
    }

    // Branch 2: leave u unmatched and continue from the next vertex.
    // Required to find the global maximum when matching u now blocks a
    // larger matching later.
    backtrack(u + 1, currentSize);
  };

  backtrack(0, 0);

  return bestMate;
};

// ---------------------------------------------------------------------------
// Bye-selection helpers
// ---------------------------------------------------------------------------

/**
 * Returns the numeric sort key for a player's bye priority.
 *
 * Never-benched players (absent from `byeWeekMap`) receive NEVER_BENCHED_SORT_KEY
 * (-Infinity), which is strictly less than any finite weekIndex, guaranteeing
 * they sort before all benched players.
 *
 * Among benched players the key is the oldest (smallest) weekIndex they hold.
 */
const byeSortKey = (
  playerId: string,
  byeWeekMap: Map<string, number>,
): number => byeWeekMap.get(playerId) ?? NEVER_BENCHED_SORT_KEY;

/**
 * Selects the player most deserving of the bye from `candidates`.
 *
 * Ordering (most deserving first):
 *   1. Never-benched players rank before any benched player.
 *   2. Among benched players, smallest (oldest) weekIndex wins.
 *   3. Ties broken by lexicographic player id (lowest id first).
 *
 * `byeWeekMap` maps playerId → oldest recorded bye weekIndex.
 */
const selectByePlayer = (
  candidates: string[],
  byeWeekMap: Map<string, number>,
): string =>
  [...candidates].sort((a, b) => {
    const ka = byeSortKey(a, byeWeekMap);
    const kb = byeSortKey(b, byeWeekMap);
    if (ka !== kb) return ka - kb;
    return a < b ? -1 : a > b ? 1 : 0;
  })[0];

/**
 * Builds a map from playerId to the oldest (smallest) recorded bye weekIndex.
 *
 * Players absent from `priorByes` do not appear in the map; callers
 * interpret a missing entry as "never benched".
 */
const buildByeWeekMap = (
  priorByes: PairingInput["priorByes"],
): Map<string, number> => {
  const byeWeekMap = new Map<string, number>();
  for (const { playerId, weekIndex } of priorByes) {
    const existing = byeWeekMap.get(playerId);
    if (existing === undefined || weekIndex < existing) {
      byeWeekMap.set(playerId, weekIndex);
    }
  }
  return byeWeekMap;
};

// ---------------------------------------------------------------------------
// Covering-matching resolver
// ---------------------------------------------------------------------------

/**
 * Attempts to find a matching that covers all `n` vertices (or all but one
 * when `n` is odd) using only the edges in `adj`.
 *
 * Returns `{ mate, covered: true }` when a covering matching is found,
 * or `{ mate, covered: false }` with the best matching achievable when it
 * is not possible to cover all vertices.
 */
const findCoveringMatching = (
  adj: Graph,
  n: number,
): { mate: number[]; covered: boolean } => {
  const mate = maximumMatching(adj);
  const unmatchedCount = mate.filter((m) => m === UNMATCHED).length;

  // A covering matching exists when at most one vertex is unmatched (odd n).
  const maxAllowedUnmatched = n % 2 === 0 ? 0 : 1;
  const covered = unmatchedCount <= maxAllowedUnmatched;

  return { mate, covered };
};

// ---------------------------------------------------------------------------
// Edge-group sorting for fallback
// ---------------------------------------------------------------------------

/**
 * Groups prior pairs by weekIndex, sorted ascending (oldest first).
 * Each group is a list of `[u, v]` index pairs for active vertices.
 *
 * Pairs that reference player ids not in `idToIndex` (absent players) are
 * silently ignored.
 */
const buildForbiddenGroups = (
  priorPairs: PriorPair[],
  idToIndex: Map<string, number>,
): { weekIndex: number; edges: [number, number][] }[] => {
  const grouped = new Map<number, [number, number][]>();

  for (const { a, b, weekIndex } of priorPairs) {
    const u = idToIndex.get(a);
    const v = idToIndex.get(b);
    if (u === undefined || v === undefined) continue;

    const edges = grouped.get(weekIndex) ?? [];
    edges.push([u, v]);
    grouped.set(weekIndex, edges);
  }

  return [...grouped.entries()]
    .sort(([wa], [wb]) => wa - wb)
    .map(([weekIndex, edges]) => ({ weekIndex, edges }));
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Computes pairings for one week.
 *
 * Pure function — does not mutate any input. The algorithm is:
 *
 *   1. For odd present counts, pre-select the bye player using the
 *      least-recently-benched rule (see `selectByePlayer`).
 *      Remove the bye player from the active set before matching.
 *   2. Build a graph of all possible active-player pairs, excluding those
 *      in `priorPairs` (forbidden edges).
 *   3. Run maximum matching on the fresh graph.
 *   4. If the matching covers all active players → `usedFallback = false`.
 *   5. Otherwise, re-admit forbidden edge groups one batch at a time (ordered
 *      by oldest weekIndex first) until a covering matching is found.
 *      Set `usedFallback = true`.
 *
 * Never throws for any non-empty `presentPlayerIds`.
 */
export const computePairing = (input: PairingInput): PairingResult => {
  // --- Defensive copy of inputs (purity guarantee) -------------------------
  const presentPlayerIds = [...input.presentPlayerIds];
  const priorPairs = input.priorPairs.map((p) => ({ ...p }));
  const priorByes = input.priorByes.map((b) => ({ ...b }));

  const n = presentPlayerIds.length;

  // --- Edge case: single player -------------------------------------------
  if (n === 1) {
    return { pairs: [], byePlayerId: presentPlayerIds[0], usedFallback: false };
  }

  // --- Build bye-week lookup -----------------------------------------------
  const byeWeekMap = buildByeWeekMap(priorByes);

  // --- Pre-select bye for odd present count --------------------------------
  // For an odd number of players, exactly one must sit out. We select the
  // most deserving bye candidate up front, then run the matching on the
  // remaining even-count active set. This ensures the bye selection is driven
  // by history, not by which vertex the matching algorithm happens to leave
  // uncovered.
  let byePlayerId: string | null = null;
  let activePlayerIds = presentPlayerIds;

  if (n % 2 !== 0) {
    byePlayerId = selectByePlayer(presentPlayerIds, byeWeekMap);
    activePlayerIds = presentPlayerIds.filter((id) => id !== byePlayerId);
  }

  const activeCount = activePlayerIds.length;

  // Safety guard for n=0 inputs (n=1 is already handled above).
  if (activeCount === 0) {
    return { pairs: [], byePlayerId, usedFallback: false };
  }

  // --- Build vertex index mapping -----------------------------------------
  // Sort ids deterministically so the algorithm output is stable regardless
  // of input order.
  const sortedActiveIds = [...activePlayerIds].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const idToIndex = new Map<string, number>(
    sortedActiveIds.map((id, i) => [id, i]),
  );

  // --- Build the forbidden-edge groups (sorted oldest first) ---------------
  const forbiddenGroups = buildForbiddenGroups(priorPairs, idToIndex);

  // Collect all forbidden edges as index pairs.
  const allForbiddenEdges: [number, number][] = forbiddenGroups.flatMap(
    (g) => g.edges,
  );

  // --- Attempt fresh matching (no forbidden edges re-admitted) -------------
  const completeGraph = buildCompleteGraph(activeCount);
  const freshGraph = removeEdges(completeGraph, allForbiddenEdges);
  const { mate: freshMate, covered: freshCovered } = findCoveringMatching(
    freshGraph,
    activeCount,
  );

  // --- Determine final mate array and fallback flag -----------------------
  let finalMate = freshMate;
  let usedFallback = false;

  if (!freshCovered) {
    // Progressive fallback: re-admit forbidden edges batch by batch (oldest
    // weekIndex first) until a covering matching is found.
    usedFallback = true;

    // Track which forbidden edges remain using a Set keyed by "u-v" (u < v).
    const remainingForbidden = new Set<string>(
      allForbiddenEdges.map(([u, v]) => edgeKey(u, v)),
    );

    for (const group of forbiddenGroups) {
      // Re-admit this batch by removing its edges from the forbidden set.
      for (const [u, v] of group.edges) {
        remainingForbidden.delete(edgeKey(u, v));
      }

      // Rebuild forbidden list from the set for removeEdges.
      const forbiddenList: [number, number][] = [...remainingForbidden].map(
        (key) => {
          const [a, b] = key.split("-").map(Number);
          return [a, b];
        },
      );

      const graph = removeEdges(completeGraph, forbiddenList);
      const { mate, covered } = findCoveringMatching(graph, activeCount);

      finalMate = mate;
      if (covered) {
        break;
      }
    }
  }

  // --- Extract pairs from mate[] -------------------------------------------
  const pairs: [string, string][] = [];
  const visited = new Set<number>();

  for (let u = 0; u < activeCount; u += 1) {
    const v = finalMate[u];
    if (v !== UNMATCHED && !visited.has(u) && !visited.has(v)) {
      pairs.push([sortedActiveIds[u], sortedActiveIds[v]]);
      visited.add(u);
      visited.add(v);
    }
  }

  return { pairs, byePlayerId, usedFallback };
};
