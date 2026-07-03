# Engineer Guessing Game Spec

## Overview

A weekly, turn-based "how well do you know your coworker" game for a fixed roster of ~26 engineers at Klar. Each week the system pairs everyone who is present, generates four icebreaker questions, and asks both players to answer them about themselves. Each player then guesses their opponent's answers from AI-generated multiple choice. Correct guesses and participation earn points that feed a seasonal and all-time leaderboard. The goal is lightweight, recurring social connection across the engineering team, automated end-to-end except for a weekly question-approval step.

## Core concepts & glossary

| Term | Meaning |
|------|---------|
| **Roster** | The fixed list of ~26 engineers. Members are "in" by default; the admin flags absences. |
| **Player** | A roster member who is not flagged absent for the current week. |
| **Week** | A Monday→Sunday cycle (UTC). The unit of play. |
| **Pairing / Matchup** | Two players matched for one week. |
| **Bye** | The leftover player when the present count is odd. Scores 0 that week. |
| **Question** | An icebreaker prompt (e.g. "What's your favorite food?"). 4 per week, same set for all pairs. |
| **Answer** | A player's free-text response about themselves. |
| **Distractor** | An AI-generated wrong option presented alongside the real answer in multiple choice. |
| **Guess** | A player's multiple-choice selection of what they think their opponent answered. |
| **Season** | A quarterly (~13 week) competition. Points and pairing history reset at season start; all-time totals persist. |
| **Admin** | The single organizer (initially `craig.f@getklar.com`) who approves questions, manages the roster, and controls seasons via a web admin panel. |

## Game rules (authoritative)

### Pairing
- Each week, all present players are paired into the maximum number of matchups.
- **No pairing may repeat within a season.**
- If the present count is odd, exactly one player gets a **bye**, assigned to the **least-recently-benched** present player (ties broken arbitrarily/deterministically, e.g. lowest player id). A player on bye scores **0** for the week.
- **Fallback:** if no perfect "all-fresh" matching exists for the present set (possible mid-season due to absences), allow repeats by preferring the pairs whose previous matchup was **longest ago** (least-recently-matched). The game must never stall on pairing.

### Questions
- Exactly **4 questions per week**, the **same set for every pair**.
- Questions are **AI-generated** (Claude) before the week opens.
- The admin **must approve** the 4 questions before the week opens. There is **no auto-publish fallback** — the week does not open until approval. (Known risk: stalls if the admin is unavailable. See Risks.)

### Answering
- Both players answer all 4 questions about themselves as **free text**.
- When a player submits an answer, the system generates **multiple-choice options** for that answer: the real answer plus AI-generated **distractors** (target 3 distractors → 4 options total). Distractors are **not** admin-reviewed.

### Guessing
- Guessing is **per-pair** and **unlocks only after BOTH players in the pair have submitted all their answers**.
- Each player guesses their opponent's answer to each of the 4 questions via multiple choice.
- **Full reveal:** immediately after submitting a guess, the player sees whether it was correct and the real answer.

### Scoring
- **+1** per correct guess.
- **+1** flat for participating (defined as: the player submitted at least their own answers — i.e. they showed up and played). 
- **Bye → 0** points for the week.
- **Silent opponent:** if your opponent never answers, the guessing gate never opens, so you cannot earn guess points. You still receive your **+1 participation** (assuming you answered). The silent player gets **0**.
- **Max per week = 5** (4 correct guesses + 1 participation).

> Note on the participation point: it is awarded for submitting your own answers, independent of whether guessing ever unlocks. This is what guarantees the "silent opponent → you still get +1" rule.

### Week lifecycle (rolling, self-paced)
- Weeks run **Monday 00:00 → Sunday 23:59:59 UTC**.
- Within a week there are **no hard mid-week phases**; players self-pace. Guessing unlocks per-pair as soon as both have answered.
- At **week close**: finalize scoring, generate head-to-head recaps, update leaderboards, send results DMs.
- The **next** week does not open until the admin has approved its questions.

### Seasons
- A season is **quarterly (~13 weeks)**.
- At season start: **season points reset to 0** and **pairing history clears** (old matchups may recur fresh — this also resolves the ~25-week no-repeat ceiling for a 26-person roster).
- **All-time** totals accumulate across seasons and never reset.
- **Tie-break** (both season and all-time leaderboards): **most correct guesses** (participation points excluded from the tiebreak). If still tied, display as tied / equal rank.

## User flows

### Player — answer phase
1. Monday: receives Slack DM "New week — answer now" with a link.
2. Opens web app (authenticated via Google SSO), sees this week's 4 questions and their opponent's name.
3. Submits free-text answers to all 4 questions.
4. System generates distractors for each submitted answer in the background.
5. If the opponent has already finished, guessing unlocks immediately; otherwise the player waits.

### Player — guess phase
1. When the opponent finishes answering, receives Slack DM "Guessing unlocked".
2. Returns to the app; for each of the 4 questions, sees the question + 4 multiple-choice options (opponent's real answer + 3 distractors, shuffled) and selects a guess.
3. On submit, immediately sees correct/incorrect and the real answer (full reveal).

### Player — week close
1. Receives Slack DM "Weekly results": their score, head-to-head recap (e.g. "You 3/4, Alex 4/4"), and current leaderboard position.
2. Can view the full recap and updated leaderboard in the app.

### Player — end-of-week reminder
- If the player still has unanswered questions or unused guesses as the week nears close, receives a nudge DM.

### Admin — weekly approval
1. Before/at the start of a new week, AI drafts 4 questions.
2. Admin opens the admin panel, reviews the 4 questions, edits/swaps/regenerates as needed, and approves.
3. On approval, the week opens and "New week" DMs are sent to all present players.

### Admin — roster & absences
- Admin manages the roster (add/remove members; each member has name, email, Slack user mapping).
- Admin flags members absent for a given week before pairing is generated.

### Admin — season control
- Admin can view current season status. Seasons advance quarterly; the spec assumes automatic quarterly boundaries with the reset behavior above. (Manual "end season" is out of scope for v1 unless trivial.)

## Data model

Tables (Postgres). Names indicative.

### `players`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| email | text unique | getklar.com Google identity |
| name | text | display name |
| slack_user_id | text | for DMs; nullable until mapped |
| is_admin | bool | default false |
| active | bool | on the roster (default true) |
| created_at | timestamptz | |

### `seasons`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| name | text | e.g. "2026 Q3" |
| starts_on | date | |
| ends_on | date | |
| is_current | bool | exactly one current |

### `weeks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| season_id | uuid (fk) | |
| starts_at | timestamptz | Monday 00:00 UTC |
| ends_at | timestamptz | Sunday 23:59:59 UTC |
| status | enum | `draft_questions`, `awaiting_approval`, `open`, `closed` |
| questions_approved_at | timestamptz | null until approved |

### `questions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| week_id | uuid (fk) | |
| order_index | int | 0–3 |
| text | text | the prompt |
| approved | bool | |

### `week_participants`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| week_id | uuid (fk) | |
| player_id | uuid (fk) | |
| absent | bool | flagged by admin |
| is_bye | bool | got the bye this week |

### `matchups`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| week_id | uuid (fk) | |
| player_a_id | uuid (fk) | |
| player_b_id | uuid (fk) | |
| guessing_unlocked_at | timestamptz | set when both have answered |

### `answers`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| matchup_id | uuid (fk) | |
| question_id | uuid (fk) | |
| player_id | uuid (fk) | who it's about |
| text | text | free-text real answer |
| submitted_at | timestamptz | |

### `answer_options`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| answer_id | uuid (fk) | |
| text | text | one option (real or distractor) |
| is_correct | bool | true for the real answer |

### `guesses`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (pk) | |
| matchup_id | uuid (fk) | |
| question_id | uuid (fk) | |
| guesser_id | uuid (fk) | the player guessing |
| chosen_option_id | uuid (fk) | |
| is_correct | bool | computed at submit |
| submitted_at | timestamptz | |

### `scores` (or derived)
Weekly per-player score can be derived from guesses + participation + bye, but a materialized `weekly_scores` row per (week, player) is recommended for fast leaderboards.

| Column | Type | Notes |
|--------|------|-------|
| week_id | uuid (fk) | |
| player_id | uuid (fk) | |
| season_id | uuid (fk) | denormalized for season leaderboard |
| participation_points | int | 0 or 1 |
| correct_guesses | int | also used for tiebreak |
| total_points | int | participation + correct_guesses |

### `pairing_history`
Effectively derivable from `matchups` joined to `weeks`/`seasons`, but a helper index/view keyed by (season_id, player_a, player_b) supports the no-repeat constraint efficiently.

## Backend requirements & endpoints

### Auth
- **Google SSO**, restricted to the `getklar.com` domain.
- Session-based; every page/endpoint requires an authenticated roster member.
- Admin-only endpoints require `is_admin`.

### Player API
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/me/week` | Current week: my matchup, my answer status, opponent answer status, whether guessing is unlocked, my recap if closed. |
| POST | `/api/me/answers` | Submit my 4 free-text answers. Triggers distractor generation. |
| GET | `/api/me/guess` | If unlocked, the 4 questions + shuffled options for my opponent. |
| POST | `/api/me/guesses` | Submit a guess; returns correct/incorrect + real answer (full reveal). |
| GET | `/api/leaderboard?scope=season\|all_time` | Ranked players with tiebreak applied. |
| GET | `/api/me/history` | My past matchups and recaps. |

### Admin API
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/admin/week/draft` | The draft (unapproved) questions for the upcoming week. |
| POST | `/api/admin/week/questions` | Edit/replace a question; regenerate via AI. |
| POST | `/api/admin/week/approve` | Approve the 4 questions → opens the week, generates pairings, sends DMs. |
| GET/POST | `/api/admin/roster` | Manage players (add/remove, slack mapping, admin flag). |
| POST | `/api/admin/week/absences` | Flag players absent for the upcoming week (before pairing). |
| GET | `/api/admin/season` | Current season status. |

### Scheduled jobs (cron)
- **Weekly question draft** (e.g. Friday/weekend before): generate 4 AI questions for the upcoming week → status `awaiting_approval`. Notify admin.
- **Week open**: on admin approval (event-driven, not cron) — generate pairings (respecting no-repeat + bye + fallback), create matchups, send "New week" DMs.
- **End-of-week reminder** (e.g. Saturday): DM players with outstanding answers/guesses.
- **Week close** (Sunday 23:59:59 UTC): finalize scoring, write `weekly_scores`, build recaps, send results DMs, advance to next week's draft.
- **Season rollover** (quarterly boundary): start new season, reset season points + pairing history, keep all-time.

### AI integration (Claude)
- **Question generation:** prompt Claude for 4 distinct, workplace-appropriate icebreaker questions. Output reviewed by admin before publish.
- **Distractor generation:** given a question and a player's real free-text answer, prompt Claude for 3 plausible, clearly-wrong-but-believable distractors of similar form/length. Generated when the answer is submitted; stored as `answer_options`. Not admin-reviewed (mitigation: future player "report" button).
- Use the latest appropriate Claude model; keep prompts and model id in config.

### Slack integration
- Slack app with a bot token; DMs sent via `chat.postMessage` to `slack_user_id`.
- Four DM triggers: (1) new week / answer now, (2) guessing unlocked, (3) end-of-week reminder, (4) weekly results.
- Requires mapping each roster email → Slack user id (lookup by email at roster setup).

## Pairing algorithm (implementation note)
- Model present players as nodes; forbidden edges = pairs already matched this season.
- Compute a maximum matching on the allowed-edges graph.
- If a perfect matching (covering all but at most one node) is found, use it; the uncovered node (if any) is the **bye → least-recently-benched** among present players.
- If no such matching exists, relax: re-introduce forbidden edges weighted by recency (oldest matchup first) and re-solve so the game proceeds with least-recent repeats.
- Bye selection prefers the present player with the oldest (or no) prior bye.

## UI / routes (Next.js)

| Route | Purpose |
|-------|---------|
| `/` | Player home: this week's matchup, answer/guess CTA, status, recap when closed. |
| `/guess` | Guess flow for the current matchup (gated until unlocked). |
| `/leaderboard` | Season + all-time leaderboards with tiebreak; toggle scope. |
| `/history` | My past matchups and recaps. |
| `/admin` | Admin dashboard (admin-only). |
| `/admin/questions` | Review/edit/approve the upcoming week's 4 questions. |
| `/admin/roster` | Manage roster + absences. |
| `/api/auth/*` | Google SSO callback/session. |

Key components: `MatchupCard`, `AnswerForm` (4 free-text inputs), `GuessForm` (4 multiple-choice), `RevealResult`, `RecapCard` (head-to-head X/4), `LeaderboardTable` (scope toggle + tiebreak), `AdminQuestionReview`, `RosterManager`.

## Tech stack & hosting
- **Next.js** (full-stack, App Router) + **Postgres**.
- Deploy on **Vercel**; managed Postgres (e.g. Neon/Supabase/Vercel Postgres).
- Cron via Vercel Cron (or equivalent) for the scheduled jobs.
- **Google SSO** (NextAuth or equivalent) restricted to `getklar.com`.
- **Slack** Web API for DMs.
- **Claude API** for question + distractor generation.

## Mock strategy (frontend before backend)
- Build UI against typed fixtures: a mock current-week payload (matchup, questions, opponent status), a mock guess payload (questions + shuffled options), and mock leaderboard/recap data.
- Stub the four API reads (`/api/me/week`, `/api/me/guess`, `/api/leaderboard`, `/api/me/history`) with static JSON so all player screens render and the answer→unlock→guess→reveal→recap flow is clickable.
- Stub AI (canned questions/distractors) and Slack (log instead of send) behind interfaces so the loop runs end-to-end locally without external calls.

## Implementation order
1. **Schema + auth:** Postgres tables, Google SSO locked to getklar.com, roster CRUD, seed ~26 players + Slack id mapping.
2. **Admin questions + week open:** AI question draft, admin review/approve, week record + status machine.
3. **Pairing engine:** matching with no-repeat, bye (least-recently-benched), and least-recent-repeat fallback. Unit-test odd/even, exhausted-matching, and absence cases.
4. **Answer flow:** answer form, submission, distractor generation, per-pair guessing-unlock logic.
5. **Guess flow + reveal:** multiple-choice guessing, correctness, instant full reveal.
6. **Scoring + leaderboards:** weekly score materialization, season + all-time views, most-correct-guesses tiebreak.
7. **Week close + recaps:** Sunday close job, head-to-head recap generation.
8. **Slack DMs:** all four triggers.
9. **Seasons:** quarterly rollover with point + pairing-history reset, all-time preservation.
10. **Polish & risk mitigations:** end-of-week reminders, (later) backup admin + player report button.

## Risks & flagged decisions (carry forward)
- **Single point of failure:** sole admin + "week waits for approval" stalls the game when the admin is away. *Recommended mitigation:* support a backup admin (`is_admin` already supports multiple).
- **Unreviewed distractors:** only questions are admin-approved; AI distractors publish automatically. *Recommended mitigation (post-v1):* per-option "report" button that excludes/regenerates a flagged option.
- **UTC week boundaries** may feel off-hours for some players; acceptable for v1, revisit if the team is widely distributed.
