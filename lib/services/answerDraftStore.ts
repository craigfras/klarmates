/**
 * answerDraftStore — persists a player's in-progress weekly answers to
 * localStorage so an accidental tab close (or navigation) never loses typed
 * text. Services layer: pure TypeScript, no JSX/React.
 *
 * Every access is week-scoped and defensively guarded: the store is safe under
 * SSR (no window/localStorage) and against hostile storage (quota-exhausted or
 * disabled). It NEVER throws — a failed read simply yields an empty draft and a
 * failed write/clear is a silent no-op.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A questionId -> answer-text map for a single week. */
export type AnswerDraft = Record<string, string>;

// ---------------------------------------------------------------------------
// Constants — no magic strings
// ---------------------------------------------------------------------------

/** Namespaced prefix for every draft key, so drafts never collide. */
const DRAFT_KEY_PREFIX = "klarmates:answer-draft:";

/** The documented "nothing saved" result. */
const EMPTY_DRAFT: AnswerDraft = {};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Builds the week-scoped storage key for a given week. */
function draftKey(weekId: string): string {
  return `${DRAFT_KEY_PREFIX}${weekId}`;
}

/**
 * Resolves the ambient localStorage, or null when it is unavailable (SSR or a
 * disabled global). Never throws.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    if (typeof localStorage === "undefined" || localStorage === null) {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads the saved draft for a week. Returns {} when nothing is saved, when the
 * stored value is corrupt, or when storage is unavailable. Never throws.
 */
export function loadAnswerDraft(weekId: string): AnswerDraft {
  const storage = getStorage();
  if (!storage) {
    return { ...EMPTY_DRAFT };
  }

  try {
    const raw = storage.getItem(draftKey(weekId));
    if (raw === null || raw === undefined) {
      return { ...EMPTY_DRAFT };
    }
    const parsed = JSON.parse(raw) as AnswerDraft;
    return parsed ?? { ...EMPTY_DRAFT };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

/**
 * Persists the draft for a week, overwriting any previous value. A no-op when
 * storage is unavailable or its methods throw. Never throws.
 */
export function saveAnswerDraft(weekId: string, texts: AnswerDraft): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(draftKey(weekId), JSON.stringify(texts));
  } catch {
    // Quota-exhausted / disabled storage: degrade silently.
  }
}

/**
 * Removes the draft for a week, leaving other weeks untouched. A no-op when
 * there is nothing to clear or storage is unavailable. Never throws.
 */
export function clearAnswerDraft(weekId: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(draftKey(weekId));
  } catch {
    // Disabled storage: degrade silently.
  }
}
