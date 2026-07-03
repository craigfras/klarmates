# 11 — Claude Question & Distractor Generation

**Type:** HITL
**Depends on:** 09-db-backed-services

## What this delivers

Real AI content: the weekly draft pulls 4 genuine icebreaker questions from Claude (for admin approval), and submitting an answer generates 3 real, plausible distractors from Claude — replacing the canned stubs in `lib/ai.ts`.

## Human action required (why it can't be automated)

- **Obtain an Anthropic API key** and set `ANTHROPIC_API_KEY`. This requires account creation + billing and cannot be generated from code.
- (Recommended) A human eyeballs the first week's generated questions/distractors for tone before relying on it.

## Layers touched

- `lib/ai.ts` (replace stubs with Anthropic SDK calls)
- `lib/aiPrompts.ts` (prompt templates)
- `package.json` (`@anthropic-ai/sdk`)
- `.env.example`

## Tasks

### Implementation
- [ ] Add `@anthropic-ai/sdk`; create a client from `ANTHROPIC_API_KEY`. Use the latest appropriate Claude model id (keep it in config, not hardcoded inline).
- [ ] `generateQuestions(4)`: prompt for 4 distinct, workplace-appropriate, free-text icebreaker prompts; parse to `string[]`; validate exactly 4 non-empty.
- [ ] `generateDistractors(question, realAnswer)`: prompt for exactly 3 plausible-but-wrong options similar in form/length to the real answer, never duplicating it; validate count + dedupe against the real answer (case-insensitive).
- [ ] Graceful fallback: on API error or malformed output, retry once, then fall back to the canned stubs so the game never blocks.
- [ ] Keep generation server-side only; never expose the key to the client.

## Verifiable outcome

- Approving a week shows 4 real Claude-generated questions in the admin review screen.
- Submitting an answer produces 3 distinct, plausible distractors (none equal to the real answer).
- With the key unset/invalid, generation falls back to stubs and the loop still works (logged warning).
