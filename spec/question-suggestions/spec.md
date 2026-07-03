# Question Suggestions Spec

## Overview

Players can suggest icebreaker questions that the admin may use in an upcoming
week. Suggestions form a **standing, week-agnostic pool**: a player submits a
question at any time from a dedicated page, and it stays in the pool until the
admin either *uses* it (dropping its text into a chosen draft-question slot) or
*discards* it. Both actions are immediate and permanent (hard delete). This is
the first player-authored write path in the app.

## Concepts & Rules

- A suggestion is a free-standing candidate question, not tied to any specific
  week. It survives across setup cycles until consumed or removed.
- **Use** = overwrite one admin-chosen draft slot with the suggestion's text,
  then hard-delete the suggestion. The week keeps its fixed
  `WEEKLY_QUESTION_COUNT`; a suggestion never *adds* a question.
- **Discard** = hard-delete a suggestion without touching the draft.
- Removal on use is **immediate and permanent**. If the admin later regenerates
  or re-overwrites that slot, the suggestion is already gone; it is not restored.
- No confirmation dialogs — a single click on Use or Discard acts.
- Suggesting is **fire-and-forget**: a player never sees a list of their own
  past suggestions and cannot withdraw them. Only the admin can remove them.

## Data Model Changes

### New Prisma model — `QuestionSuggestion`

```prisma
model QuestionSuggestion {
  id            String   @id @default(uuid())
  text          String
  suggestedById String   @map("suggested_by_id")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz

  suggestedBy Player @relation(fields: [suggestedById], references: [id])

  @@index([suggestedById])
  @@map("question_suggestions")
}
```

- Add the back-relation `questionSuggestions QuestionSuggestion[]` to the
  `Player` model.
- No `status` column and no audit trail — used/discarded rows are deleted.
- A Prisma migration is required.

### Mock store

`GameServiceData` gains an optional parallel array:

```ts
suggestions?: StoredSuggestion[];
```

where `StoredSuggestion = { id: string; text: string; suggestedById: string; createdAt: string }`.

### View / return types (`lib/types`)

- `QuestionSuggestion` (read shape returned to the admin UI):
  `{ id: string; text: string; suggestedByName: string; createdAt: string }`.
  The suggester **name** is resolved server-side (mock: from the roster; db:
  join `Player`).

## Service Layer — `GameService` interface

Four new methods, implemented in **both** `mockGameService` and
`dbGameService`:

| Method | Behaviour |
| --- | --- |
| `suggestQuestion(playerId: string, text: string): Promise<void>` | Trim `text`; throw on empty/whitespace-only. Otherwise append a new suggestion. Works anytime, independent of whether a draft week exists. |
| `listSuggestions(): Promise<QuestionSuggestion[]>` | Return the pool **newest-first**, each with the resolved `suggestedByName`. |
| `useSuggestion(suggestionId: string, draftQuestionId: string): Promise<Question[]>` | Copy the suggestion's text into the draft slot identified by `draftQuestionId`, hard-delete the suggestion, and return the updated draft questions (same return shape as `updateDraftQuestion`). Throw on unknown suggestion id, unknown draft question id, or absent draft week. |
| `removeSuggestion(suggestionId: string): Promise<void>` | Hard-delete the suggestion. No draft change. Throw on unknown id. |

Notes:
- `useSuggestion` reuses the existing draft-slot mutation semantics (locate the
  draft question, set its `text`) so it stays consistent with
  `updateDraftQuestion`.
- The suggested text is **copied** into the slot (a snapshot). Editing the slot
  afterwards does not resurrect the deleted suggestion.

## Routes

### New — `POST /api/suggestions` (player)

- Non-admin endpoint. Resolves the current dev actor as the suggester.
- Body: `{ text: string }`.
- Delegates to `gameService.suggestQuestion(actorId, text)`.
- Validation: malformed JSON → 400; missing/empty `text` → 400 (service throws
  on whitespace-only). Success → 200.

### New — `POST /api/admin/suggestions` (admin)

Dedicated admin endpoint (deliberately **not** folded into the draft-questions
route, since `remove` does not touch the draft). Admin-guarded via
`requireAdminActor()`, mirroring the existing admin routes.

- Body: `{ action: "use" | "remove", suggestionId: string, draftQuestionId?: string }`.
- `action === "use"` → requires `draftQuestionId`; calls
  `gameService.useSuggestion(suggestionId, draftQuestionId)` and returns
  `{ questions }`.
- `action === "remove"` → calls `gameService.removeSuggestion(suggestionId)` and
  returns `{ ok: true }` (or the refreshed list).
- Auth failure → 403; malformed body / unknown action / missing field /
  service rejection → 400.

### Admin questions page — server read

The admin questions page ([app/admin/questions/page.tsx](app/admin/questions/page.tsx))
additionally calls `gameService.listSuggestions()` server-side (same pattern as
its existing `getDraftQuestions` call) and passes the list into
`AdminQuestionReview`.

## UI Changes

### New page — `/suggest` (player)

- New route `app/suggest/page.tsx` (server component) rendering a
  `SuggestForm` client component that posts to `/api/suggestions`.
- Open to any active player.
- After a successful submit: shows a "Thanks — submitted" confirmation with an
  option to add another. **No list** of past suggestions (fire-and-forget).

### Home page

- Add a **"Suggest a question →"** link on [app/page.tsx](app/page.tsx) pointing
  to `/suggest`.

### Admin — `AdminQuestionReview` (suggestion-first panel)

Beside the existing `WEEKLY_QUESTION_COUNT` draft slots, add a suggestions
panel. For each pending suggestion (newest-first):

- Display the suggestion **text** and the **suggester's name**.
- A **slot selector** labeled `Slot 1 — <current question text>` … `Slot N — …`
  so the admin sees what they are about to overwrite.
- A **Use** button → `POST /api/admin/suggestions` `{ action: "use", suggestionId, draftQuestionId }`.
  On success the returned `questions` refresh the draft slots and the used
  suggestion disappears from the list.
- A **Discard** button → `POST /api/admin/suggestions` `{ action: "remove", suggestionId }`.
- No confirmation prompts.

## Auth & Permissions

- `/suggest` and `POST /api/suggestions`: any active player (current dev actor).
- `POST /api/admin/suggestions` and the suggestions panel: admin only
  (`requireAdminActor()` / `currentPlayer.isAdmin` gate, matching existing admin
  surfaces).

## Mock Strategy

The feature is implemented behind the shared `GameService` interface, so both
`mockGameService` (in-memory `suggestions` array) and `dbGameService`
(Prisma-backed) satisfy it. The active implementation is selected by the
existing `USE_MOCK` seam — no route or UI code branches on it.

## Constraints

- Text: reject empty/whitespace-only. No max/min length — the admin verifies
  and can edit the slot text after using.
- No cap on suggestions per player or in total.
- No dedupe (exact or fuzzy).

## Implementation Order (TDD per CLAUDE.md)

Recommended as **two slices**:

**Slice A — model + service + player path**
1. `test-writer`: failing unit tests for `suggestQuestion` / `listSuggestions`
   (mock + db) and `POST /api/suggestions`.
2. Prisma model + migration; `StoredSuggestion` and `QuestionSuggestion` types.
3. `code-writer`: implement the two service methods in both services and the
   player route until tests pass.
4. `/suggest` page + `SuggestForm`; home link.
5. `code-reviewer`.

**Slice B — admin list + use/discard**
1. `test-writer`: failing unit tests for `useSuggestion` / `removeSuggestion`
   (mock + db) and `POST /api/admin/suggestions`.
2. `code-writer`: implement the two service methods in both services and the
   admin route.
3. Extend `AdminQuestionReview` with the suggestions panel; wire the admin page
   server read.
4. `code-reviewer`.

Throughout: `test-writer` first and confirmed red before `code-writer`; never
parallelize the two; pass explicit test-file paths to `code-writer`. Run
`npx tsc --noEmit` before considering either slice done (tests must be
build-clean, not just Vitest-green).
