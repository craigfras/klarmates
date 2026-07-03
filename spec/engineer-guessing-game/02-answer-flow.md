# 02 — Answer Flow (Mocked)

**Type:** AFK
**Depends on:** 01-scaffold-and-this-week-home

## What this delivers

A player can submit free-text answers to the week's 4 questions; on submit, multiple-choice options (real answer + stub distractors) are generated and stored, and the home view flips to "waiting for opponent" or "guessing unlocked".

## Layers touched

- `lib/types.ts` (answer payload types)
- `lib/services/gameService.ts` (add `submitAnswers`)
- `lib/ai.ts` (stub distractor generator behind an interface)
- `app/api/me/answers/route.ts` (POST)
- `components/AnswerForm.tsx`
- `app/page.tsx` (render AnswerForm when not yet answered)

## Tasks

### AI stub (`lib/ai.ts`)
- [ ] Define `generateDistractors(question: string, realAnswer: string): Promise<string[]>` returning 3 canned-but-plausible strings (real Claude call added in slice 11).

### Service (`lib/services/gameService.ts`)
- [ ] Add `submitAnswers(playerId, weekId, answers: {questionId, text}[]): Promise<void>`.
- [ ] On submit: persist answers; for each, build `AnswerOption[]` = real answer + `generateDistractors(...)`, store, mark `is_correct` on the real one.
- [ ] Set the matchup's `guessingUnlockedAt` when BOTH players in the pair have submitted all answers.

### API (`app/api/me/answers/route.ts`)
- [ ] `POST` validates 4 answers present, calls `submitAnswers`, returns updated `MyWeekView`.

### UI (`components/AnswerForm.tsx`)
- [ ] 4 labeled free-text inputs; submit posts to `/api/me/answers`; disable after submit.
- [ ] `app/page.tsx`: show `AnswerForm` when `!myAnswersSubmitted`; otherwise show waiting/unlocked state.

## Verifiable outcome

- Submitting answers as a player persists them and generates 4 options per answer (1 correct + 3 distractors) in the mock store.
- After one player answers, their home shows "waiting for opponent"; after both answer (verified via dev actor switch), it shows "guessing unlocked".
- Re-loading the page preserves submitted state within the mock store's lifetime.
