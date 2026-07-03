# 01 — Player can suggest a question

**Type:** AFK
**Depends on:** nothing

## What this delivers

Any active player can open `/suggest`, submit a question, and have it persisted
to the standing suggestion pool (in both the mock and the Postgres-backed
service).

## Layers touched

- `lib/types.ts` — new `StoredSuggestion` type; `suggestQuestion` on the `GameService` seam.
- `prisma/schema.prisma` — new `QuestionSuggestion` model + `Player` back-relation; migration.
- `lib/mockStore.ts` — seed/allow an in-memory `suggestions` array.
- `lib/services/gameService.ts` — `GameServiceData.suggestions?`, `suggestQuestion` impl, interface method.
- `lib/services/dbGameService.ts` — `suggestQuestion` impl via `getPrisma()`.
- `app/api/suggestions/route.ts` — new player `POST` route.
- `components/SuggestForm.tsx` — new client form (mirror `components/AnswerForm.tsx`).
- `app/suggest/page.tsx` — new server component page.
- `app/page.tsx` — "Suggest a question →" link.

## Tasks

### Tests first (TDD)
- [ ] `lib/services/gameService.suggest.test.ts` — `suggestQuestion` appends; trims; throws on empty/whitespace-only text.
- [ ] Extend the db service test suite with the same `suggestQuestion` cases.
- [ ] `app/api/suggestions/route.test.ts` — 200 on valid body; 400 on malformed JSON; 400 on missing/empty `text`.
- [ ] Confirm all red before implementing.

### Types & schema
- [ ] Add to `lib/types.ts`:
  ```ts
  export type StoredSuggestion = {
    id: string;
    text: string;
    suggestedById: string;
    createdAt: string; // ISO 8601
  };
  ```
- [ ] Add `QuestionSuggestion` model to `prisma/schema.prisma` (`id`, `text`,
  `suggestedById @map("suggested_by_id")`, `createdAt @map("created_at") @db.Timestamptz`,
  `suggestedBy Player @relation(...)`, `@@index([suggestedById])`, `@@map("question_suggestions")`)
  and add `questionSuggestions QuestionSuggestion[]` to `Player`.
- [ ] Generate the Prisma migration.

### Service seam (both implementations)
- [ ] Add `suggestions?: StoredSuggestion[]` to `GameServiceData` in `lib/services/gameService.ts`.
- [ ] Add to the `GameService` interface:
  `suggestQuestion(playerId: string, text: string): Promise<void>;`
- [ ] Mock impl: trim; throw on empty/whitespace-only; else push
  `{ id, text, suggestedById: playerId, createdAt: now() }` onto `(data.suggestions ??= [])`.
- [ ] Db impl in `lib/services/dbGameService.ts`: same trim/guard, then
  `prisma.questionSuggestion.create({ data: { text, suggestedById: playerId } })`.

### Route & UI
- [ ] `app/api/suggestions/route.ts`: resolve the dev actor via
  `getDevActor()` (as `app/page.tsx` does), safe-parse `{ text }`, delegate to
  `gameService.suggestQuestion(actor.id, text)`. Mirror the malformed-body / 400
  handling used in `app/api/admin/week/questions/route.ts` (no `requireAdminActor`).
- [ ] `components/SuggestForm.tsx` (client): single text field + submit posting
  to `/api/suggestions`; on success show a "Thanks — submitted" state with an
  "add another" reset; on failure surface `role="alert"`. Follow `AnswerForm.tsx`.
- [ ] `app/suggest/page.tsx` (server): render intro + `SuggestForm`. No list.
- [ ] `app/page.tsx`: add a `Link` to `/suggest` labeled "Suggest a question →".

## Verifiable outcome

- Submitting the `/suggest` form persists a row (mock array or
  `question_suggestions` table) and shows the "Thanks — submitted" confirmation.
- `suggestQuestion` unit tests pass in both mock and db suites; empty/whitespace
  text is rejected.
- `POST /api/suggestions` returns 200 on valid input and 400 on malformed/empty.
- A "Suggest a question →" link is visible on the home page.
- `npx tsc --noEmit` is clean.
