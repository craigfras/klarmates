# 07 — Admin: Roster & Absences (Mocked)

**Type:** AFK
**Depends on:** 06-admin-questions-and-week-open

## What this delivers

An admin-only roster screen to add/remove/edit players (name, email, Slack id, admin flag, active) and to flag players absent for the upcoming week, so pairing runs only over present players.

## Layers touched

- `lib/services/gameService.ts` (add roster + absence methods)
- `app/api/admin/roster/route.ts` (GET/POST), `app/api/admin/week/absences/route.ts` (POST)
- `app/admin/roster/page.tsx`
- `components/RosterManager.tsx`

## Tasks

### Service
- [ ] `listRoster()`, `upsertPlayer(player)`, `deactivatePlayer(id)`.
- [ ] `setWeekAbsences(weekId, absentPlayerIds[])` — must be callable only while week is `awaiting_approval`/before `openWeek`.
- [ ] `getPresentPlayers(weekId)` = active roster minus absences; used by `approveWeek`/`computePairing`.

### API + UI
- [ ] Admin-guarded roster endpoints.
- [ ] `RosterManager`: table of players with edit fields (name, email, slackUserId, isAdmin, active) and an absence checkbox per player for the upcoming week.

## Verifiable outcome

- Admin can add a new player and see them in the roster list and as a potential participant.
- Marking a player absent excludes them from that week's pairing (verified: they get no matchup after `approveWeek`).
- Editing the admin flag changes whether that player can reach admin screens.
- Absence flags are rejected once the week is `open`.
