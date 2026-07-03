# 06 — Admin: Question Review, Approve & Week Open (Mocked)

**Type:** AFK
**Depends on:** 05-pairing-engine

## What this delivers

An admin-only screen that shows the 4 AI-drafted questions for the upcoming week, lets the admin edit / swap / regenerate them, and on approval opens the week — generating pairings (via the pairing engine) and moving the week to `open`.

## Layers touched

- `lib/services/gameService.ts` (add `getDraftQuestions`, `updateDraftQuestion`, `approveWeek`)
- `lib/ai.ts` (add stub `generateQuestions(count): Promise<string[]>`)
- `app/api/admin/week/draft/route.ts` (GET), `app/api/admin/week/questions/route.ts` (POST), `app/api/admin/week/approve/route.ts` (POST)
- `app/admin/page.tsx`, `app/admin/questions/page.tsx`
- `components/AdminQuestionReview.tsx`
- `lib/authz.ts` (mock `requireAdmin` — replaced by real auth in slice 10)

## Tasks

### AI stub
- [ ] `generateQuestions(4)` returns 4 canned workplace-appropriate prompts (real Claude call in slice 11).

### Service
- [ ] `getDraftQuestions(weekId)` — creates the week in `awaiting_approval` with 4 generated questions if absent.
- [ ] `updateDraftQuestion(questionId, text)` and `regenerateQuestion(questionId)`.
- [ ] `approveWeek(weekId)` — mark approved, set status `open`, run `computePairing` over present participants, create matchups + bye. Idempotent.

### Authz
- [ ] `requireAdmin(playerId)` mock checks the fixture `isAdmin` flag; throw 403 otherwise.

### API + UI
- [ ] Admin routes guarded by `requireAdmin`.
- [ ] `AdminQuestionReview`: list 4 questions, inline edit, "regenerate" per question, and a single "Approve & open week" button.
- [ ] `app/admin/page.tsx` dashboard links to questions + roster; `Nav` shows Admin link only for admins.

## Verifiable outcome

- A non-admin dev actor gets 403 on admin routes and sees no Admin nav link.
- The admin sees 4 draft questions, can edit and regenerate them.
- Clicking "Approve & open week" sets the week to `open` and creates matchups for all present players (plus a bye if odd), verifiable on the home view of multiple dev actors.
