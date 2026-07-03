# 02 — Admin sees the suggestion pool

**Type:** AFK
**Depends on:** 01-player-suggest-a-question

## What this delivers

On the admin questions page, the admin sees every pending suggestion —
newest-first, each showing its text and the suggester's name — rendered beside
the existing draft-question slots.

## Layers touched

- `lib/types.ts` — new `QuestionSuggestion` read/view type (with resolved name).
- `lib/services/gameService.ts` — `listSuggestions` interface method + mock impl.
- `lib/services/dbGameService.ts` — `listSuggestions` impl (join `Player`).
- `app/admin/questions/page.tsx` — server read of the suggestion list.
- `components/AdminQuestionReview.tsx` — display-only suggestions panel.

## Tasks

### Tests first (TDD)
- [ ] Extend mock + db service tests: `listSuggestions` returns rows
  **newest-first** with `suggestedByName` resolved from the roster/`Player`.
- [ ] `components/AdminQuestionReview.test.tsx`: given a `suggestions` prop, the
  panel renders each text + name in newest-first order; renders nothing/empty
  state when the list is empty.

### Types
- [ ] Add to `lib/types.ts`:
  ```ts
  export type QuestionSuggestion = {
    id: string;
    text: string;
    suggestedByName: string;
    createdAt: string; // ISO 8601
  };
  ```

### Service (both implementations)
- [ ] Interface: `listSuggestions(): Promise<QuestionSuggestion[]>;`
- [ ] Mock impl: map `data.suggestions ?? []`, resolve `suggestedByName` from
  `data.players` (fall back to the id), sort by `createdAt` descending.
- [ ] Db impl: `prisma.questionSuggestion.findMany({ include: { suggestedBy: true }, orderBy: { createdAt: "desc" } })`, map to the view type.

### Page & UI
- [ ] `app/admin/questions/page.tsx`: after `getDraftQuestions`, also call
  `gameService.listSuggestions()` and pass it into `AdminQuestionReview`.
- [ ] `components/AdminQuestionReview.tsx`: add `suggestions: QuestionSuggestion[]`
  to props; render a panel listing each suggestion's text and
  `suggestedByName`, newest-first. Display only — no actions yet.

## Verifiable outcome

- Questions suggested via slice 01 appear in the admin panel, newest-first, each
  with the suggester's name.
- `listSuggestions` unit tests pass in both mock and db suites (ordering + name
  resolution).
- The panel shows an empty state when no suggestions exist.
- `npx tsc --noEmit` is clean.
