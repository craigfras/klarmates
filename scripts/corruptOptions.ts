/**
 * Shared detector for JSON-scaffolding corruption in answer_options text (ops
 * utility — not part of the app). Used by both inspect-corrupted-options.ts and
 * repair-corrupted-options.ts.
 *
 * Background: a bug in `parseGeneratedList` (lib/ai.ts) shredded truncated JSON
 * model output line-by-line, so fragments like "{", '"distractors": [', and
 * '"...",' leaked in as distractor options.
 */

/**
 * A distractor option's text is JSON-scaffolding (not a real answer) when it is
 * a bare bracket/brace, a JSON key line, or a quoted JSON string fragment left
 * over from line-splitting. Real distractors are plain sentences: they don't
 * start with `{`/`[`/`"`, don't end with `,`, and aren't a lone bracket.
 */
const CORRUPT_TEXT_PATTERNS: RegExp[] = [
  /^[{}[\]]+$/, // lone braces/brackets: {  }  [  ]  {}  []
  /^"?(distractors|questions)"?\s*:/i, // a JSON key line: "distractors": [
  /^".*",?$/, // a quoted JSON string fragment (with/without trailing comma)
  /,$/, // any line ending in a comma (JSON element separator)
];

/** True when an option's text looks like leaked JSON scaffolding. */
export const isCorruptText = (text: string): boolean => {
  const value = text.trim();
  return CORRUPT_TEXT_PATTERNS.some((pattern) => pattern.test(value));
};
