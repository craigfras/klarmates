# 04 — Admin discards a suggestion

**Type:** AFK
**Depends on:** 03-admin-uses-suggestion-into-slot

## What this delivers

The admin can permanently discard a pending suggestion without using it, via a
**Discard** button on each row of the suggestions panel.

## Layers touched

- `lib/services/gameService.ts` — `removeSuggestion` interface method + mock impl.
- `lib/services/dbGameService.ts` — `removeSuggestion` impl.
- `app/api/admin/suggestions/route.ts` — add the `remove` action.
- `components/AdminQuestionReview.tsx` — Discard button per suggestion.

## Tasks

### Tests first (TDD)
- [ ] Mock + db service tests for `removeSuggestion(suggestionId)`: hard-deletes
  the suggestion; throws on unknown id; no draft change.
- [ ] Extend `app/api/admin/suggestions/route.test.ts`: `action:"remove"` → 200;
  403 for non-admin; 400 for malformed body / unknown action / service rejection.
- [ ] `AdminQuestionReview.test.tsx`: clicking Discard posts
  `{ action:"remove", suggestionId }` and refreshes.

### Service (both implementations)
- [ ] Interface: `removeSuggestion(suggestionId: string): Promise<void>;`
- [ ] Mock impl: remove the matching entry from `data.suggestions`; throw on
  unknown id.
- [ ] Db impl: `prisma.questionSuggestion.delete({ where: { id } })`; surface a
  clear error on unknown id.

### Route & UI
- [ ] `app/api/admin/suggestions/route.ts`: add `action === "remove"` →
  `gameService.removeSuggestion(suggestionId)`; return `{ ok: true }`. Keep the
  admin guard and error mapping from slice 03.
- [ ] `components/AdminQuestionReview.tsx`: add a **Discard** button per
  suggestion posting via `postAndRefresh` to `/api/admin/suggestions` with
  `{ action:"remove", suggestionId }`. No confirmation dialog. On success the
  suggestion drops out of the list.

## Verifiable outcome

- Clicking Discard removes the suggestion from the panel and it does not return.
- The draft slots are unchanged by a discard.
- `removeSuggestion` unit tests pass in both mock and db suites.
- `POST /api/admin/suggestions` with `action:"remove"` returns 200 for admins
  and 403 for non-admins.
- `npx tsc --noEmit` is clean.
