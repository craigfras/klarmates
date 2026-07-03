/**
 * AI prompt templates (pure).
 *
 * These builders produce the user-message text sent to the model for the two
 * generation tasks: weekly icebreaker questions and per-answer distractors.
 * They are pure string functions — no SDK import, no network, no side effects —
 * so they can be unit-tested in isolation and reused by any transport.
 *
 * Dynamic inputs (count, question, realAnswer) are always embedded verbatim so
 * the consuming validator/dedupe step can rely on a clean, structured response.
 */

// ---------------------------------------------------------------------------
// Shared fragments (named constants — no repeated literals)
// ---------------------------------------------------------------------------

/** Reusable instruction to return a single JSON object and nothing else. */
const JSON_ONLY_INSTRUCTION =
  "Respond with a single JSON object and no other text, markdown, or commentary.";

/** Key the questions response object must use for its string array. */
const QUESTIONS_JSON_KEY = "questions";

/** Key the distractors response object must use for its string array. */
const DISTRACTORS_JSON_KEY = "distractors";

// ---------------------------------------------------------------------------
// Questions prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt asking the model for `count` icebreaker questions.
 *
 * Embeds `count` verbatim and constrains the output to distinct, ultra-short,
 * open-ended, workplace-appropriate questions spread across connection-focused
 * categories. The final line keeps the machine-readable JSON response contract
 * the parser depends on — the "flat list" the model is asked for is delivered as
 * the JSON string array (no preamble, numbering, or category labels).
 */
export const buildQuestionsPrompt = (count: number): string =>
  `Generate exactly ${count} distinct, ultra-short, highly creative icebreaker questions for a workplace team game.

### Core Goal:
The goal is connection through refreshing, unexpected questions. The prompts must avoid predictable icebreaker tropes and instead spark unique, specific stories or facts about coworkers.

### Core Requirements:
*   **Format:** Each question must be a single, short sentence (under 15 words).
*   **Open-Ended:** Every question must allow for multiple, unique open-text answers. Absolutely no binary, "this-or-that," or yes/no questions.
*   **Safety:** Entirely workplace-appropriate. Avoid sensitive personal topics (romance, politics, finances, family).

### High-Creativity Categories (Select and shuffle randomly):
1.  **Hyper-Specific Preferences:** Utterly unique tastes (e.g., "What specific smell instantly makes you feel nostalgic?").
2.  **Unusual Expertise:** Obscure knowledge or niche things people have researched deeply.
3.  **Lighthearted Absurdity / Imaginative:** Low-stakes, bizarre, or playful scenarios.
4.  **Media & Niche Fandoms:** Specific elements of pop culture, books, games, or shows.
5.  **Micro-Habits:** The tiny, peculiar ways people navigate their day or space.
6.  **Mild Material Obsessions:** Small, specific physical objects people love or collect.

### CRITICAL: Banned Tropes (Do NOT use these concepts):
To force maximum creativity, you are strictly forbidden from generating questions about the following overused topics:
*   NO questions about: Superpowers, Time Travel, Desert Islands, Comfort Foods, Lottery/Winning Money, First Jobs, or Favorite Animals.
*   NO standard corporate clichéd words: "Five years," "Passion," "Inspirational," "Role model."
*   NO "this-or-that" choices (e.g., no "Cats vs. dogs", "Coffee vs. tea").

### Tone Shift Instruction:
Focus on the *fringe* details of daily life, memory, and imagination. Avoid broad questions ("What is your favorite book?") and instead ask for specific instances ("What book have you re-read the most times?").

### Reference Examples (For Creative Inspiration Only):
*   What is a highly specific niche topic you could give a 10-minute presentation on right now?
*   What movie or TV show quote slipped into your everyday vocabulary?
*   What minor, low-stakes hill are you absolutely willing to die on?
*   What is the weirdest, most specific object currently sitting on your desk?
*   What specific smell instantly brings back a vivid childhood memory?

### Response Format:
${JSON_ONLY_INSTRUCTION} Use the shape {"${QUESTIONS_JSON_KEY}": ["...", ...]} with exactly ${count} strings, each string a single question.`;

// ---------------------------------------------------------------------------
// Distractors prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt asking the model for `count` plausible-but-wrong answers.
 *
 * Embeds the literal `question`, the literal `realAnswer`, and `count`. The
 * distractors must resemble the real answer in form and length but must never
 * duplicate it.
 */
export const buildDistractorsPrompt = (
  question: string,
  realAnswer: string,
  count: number,
): string =>
  [
    `For an icebreaker guessing game, the question is: "${question}".`,
    `One player's real answer is: "${realAnswer}".`,
    `Generate exactly ${count} plausible but wrong alternative answers that a`,
    "different person might plausibly have given. Each distractor should be",
    "similar in form, style, and length to the real answer so it is hard to",
    `tell apart. Never duplicate the real answer "${realAnswer}", and do not`,
    "repeat any distractor.",
    `${JSON_ONLY_INSTRUCTION} Use the shape ` +
      `{"${DISTRACTORS_JSON_KEY}": ["...", ...]} with exactly ${count} strings.`,
  ].join(" ");
