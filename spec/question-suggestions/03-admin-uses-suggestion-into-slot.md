# 03 — Admin uses a suggestion into a chosen slot

**Type:** AFK
**Depends on:** 02-admin-sees-suggestion-pool

## What this delivers

For each pending suggestion the admin picks a target draft slot and clicks
**Use**: the slot's text is overwritten with the suggestion's text, and the
suggestion is permanently removed from the pool.

## Layers touched

- `lib/services/gameService.ts` — `useSuggestion` interface method + mock impl.
- `lib/services/dbGameService.ts` — `useSuggestion` impl.
- `app/api/admin/suggestions/route.ts` — new admin route, `use` action.
- `components/AdminQuestionReview.tsx` — per-suggestion slot selector + Use button.

## Tasks

### Tests first (TDD)
- [ ] Mock + db service tests for `useSuggestion(suggestionId, draftQuestionId)`:
  overwrites the target draft slot text; deletes the suggestion; returns the
  updated draft questions; throws on unknown suggestion id, unknown draft
  question id, or absent draft week. Verify the delete is permanent (a follow-up
  `listSuggestions` no longer contains it).
- [ ] `app/api/admin/suggestions/route.test.ts`: `action:"use"` → 200 with
  `{ questions }`; 403 for non-admin; 400 for malformed body / missing
  `draftQuestionId` / service rejection.
- [ ] `AdminQuestionReview.test.tsx`: selecting a slot + clicking Use posts
  `{ action:"use", suggestionId, draftQuestionId }` and refreshes.

### Service (both implementations)
- [ ] Interface:
  `useSuggestion(suggestionId: string, draftQuestionId: string): Promise<Question[]>;`
- [ ] Mock impl: locate suggestion in `data.suggestions`; locate the draft
  question (reuse the same lookup `updateDraftQuestion` uses); set its `text` to
  the suggestion text; remove the suggestion from `data.suggestions`; return the
  sorted draft questions (same return shape as `updateDraftQuestion`).
- [ ] Db impl: in a `prisma.$transaction`, update the `Question.text` and delete
  the `QuestionSuggestion`; return the refreshed draft questions.

### Route & UI
- [ ] `app/api/admin/suggestions/route.ts`: guard with `requireAdminActor()`;
  parse `{ action, suggestionId, draftQuestionId }`; for `action === "use"`
  require `draftQuestionId`, call `gameService.useSuggestion(...)`, return
  `{ questions }`. Reuse `mapAdminError` / HTTP constants from
  `lib/use-cases/adminApi.ts`. Mirror `app/api/admin/week/questions/route.ts`.
- [ ] `components/AdminQuestionReview.tsx`: per suggestion add a slot `<select>`
  labeled `Slot 1 — <current question text>` … `Slot N — …` (options derived
  from the `questions` prop) and a **Use** button posting via the existing
  `postAndRefresh` helper to `/api/admin/suggestions`. On success the returned
  `questions` refresh the slots and the used suggestion drops out of the list.

## Verifiable outcome

- Choosing a slot and clicking Use overwrites that slot's text with the
  suggestion and the suggestion disappears from the panel.
- The removal is permanent — regenerating/overwriting the slot afterwards does
  not bring the suggestion back.
- `useSuggestion` unit tests pass in both mock and db suites, including the
  error cases.
- `POST /api/admin/suggestions` with `action:"use"` returns 200/`{ questions }`
  for admins and 403 for non-admins.
- `npx tsc --noEmit` is clean.
