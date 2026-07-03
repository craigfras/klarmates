# 01 — Scaffold & "This Week" Home (Mocked)

**Type:** AFK
**Depends on:** nothing

## What this delivers

A running Next.js app where visiting `/` shows the current week's matchup card (opponent name, the 4 questions, and your answer/guess status) rendered from mock fixtures — plus a dev-only "act as player" switcher so multi-player flows are demoable before real auth.

## Layers touched

- `package.json`, `next.config.ts`, `tsconfig.json` (scaffold)
- `app/layout.tsx`, `app/page.tsx` (home / this-week view)
- `app/globals.css`
- `lib/types.ts` (domain types)
- `lib/fixtures.ts` (mock data)
- `lib/services/gameService.ts` (service interface + mock implementation)
- `lib/devActor.ts` (dev-only current-player selection)
- `components/MatchupCard.tsx`, `components/Nav.tsx`, `components/DevActorSwitcher.tsx`

## Tasks

### Scaffold
- [ ] `npx create-next-app@latest` with TypeScript + App Router + ESLint; confirm `npm run dev` boots.
- [ ] Add a simple global layout and `Nav` (links: Home, Leaderboard, History; Admin link gated later).

### Types (`lib/types.ts`)
- [ ] Define domain types matching the spec data model:
  ```ts
  export type Player = { id: string; name: string; email: string; slackUserId?: string; isAdmin: boolean; active: boolean };
  export type Question = { id: string; orderIndex: number; text: string };
  export type AnswerOption = { id: string; text: string; isCorrect: boolean };
  export type WeekStatus = 'draft_questions' | 'awaiting_approval' | 'open' | 'closed';
  export type MyWeekView = {
    weekId: string; status: WeekStatus; opponent: Player | null; isBye: boolean;
    questions: Question[];
    myAnswersSubmitted: boolean; opponentAnswered: boolean; guessingUnlocked: boolean;
    recap?: Recap;
  };
  export type Recap = { meCorrect: number; opponentCorrect: number; questionCount: number };
  ```

### Mock service (`lib/services/gameService.ts`)
- [ ] Declare a `GameService` interface with `getMyWeek(playerId): Promise<MyWeekView>` (the only method needed this slice).
- [ ] Provide `mockGameService` reading from `lib/fixtures.ts` (2+ players, one open week, 4 questions, a matchup).

### Home (`app/page.tsx`)
- [ ] Server component calls `getMyWeek(currentDevPlayerId)` and renders `MatchupCard`.
- [ ] `MatchupCard` shows opponent, the 4 questions, and status badges (answered / waiting / guessing unlocked / bye).

### Dev actor switcher
- [ ] `DevActorSwitcher` (cookie-backed `devPlayerId`) to impersonate any fixture player; visible only when `NODE_ENV !== 'production'`.

## Verifiable outcome

- `npm run dev` serves `/` with no errors.
- The home page shows a matchup card with an opponent, 4 questions, and correct status badges from fixtures.
- Switching the dev actor changes the rendered matchup/opponent.
- `lib/types.ts` exports the domain types used by later slices.
