# 03 — Guess Flow & Instant Reveal (Mocked)

**Type:** AFK
**Depends on:** 02-answer-flow

## What this delivers

Once guessing is unlocked for a pair, a player can guess their opponent's answer to each of the 4 questions via shuffled multiple choice, and sees correct/incorrect plus the real answer immediately on each submit (full reveal).

## Layers touched

- `lib/types.ts` (guess payload + reveal result types)
- `lib/services/gameService.ts` (add `getGuessSheet`, `submitGuess`)
- `app/api/me/guess/route.ts` (GET), `app/api/me/guesses/route.ts` (POST)
- `app/guess/page.tsx`
- `components/GuessForm.tsx`, `components/RevealResult.tsx`

## Tasks

### Types
- [ ] `GuessSheet = { questionId: string; questionText: string; options: AnswerOption[] }[]` (options shuffled, `isCorrect` stripped before send).
- [ ] `GuessResult = { questionId: string; correct: boolean; realAnswerText: string }`.

### Service
- [ ] `getGuessSheet(playerId, weekId): Promise<GuessSheet>` — opponent's options per question, **shuffled**, with `isCorrect` removed from the client payload.
- [ ] Guard: throw if `guessingUnlocked` is false for this player's matchup.
- [ ] `submitGuess(playerId, weekId, questionId, chosenOptionId): Promise<GuessResult>` — record guess, compute `is_correct`, return reveal.

### API
- [ ] `GET /api/me/guess` returns the `GuessSheet` (403 if not unlocked).
- [ ] `POST /api/me/guesses` returns a `GuessResult`.

### UI
- [ ] `app/guess/page.tsx` fetches the sheet; `GuessForm` renders 4 questions × 4 options (radio).
- [ ] On each guess submit, `RevealResult` shows ✓/✗ and the real answer inline; lock that question after answering.
- [ ] Home CTA links to `/guess` only when `guessingUnlocked`.

## Verifiable outcome

- With both players answered (dev actor), `/guess` shows 4 questions each with 4 shuffled options and no leaked `isCorrect` in the network payload.
- Submitting a guess immediately reveals correct/incorrect and the real answer.
- Attempting `/guess` before unlock returns 403 and the UI hides the CTA.
- Each question can only be guessed once.
