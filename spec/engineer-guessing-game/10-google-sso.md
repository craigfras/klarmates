# 10 — Google SSO (Restricted to getklar.com)

**Type:** HITL
**Depends on:** 09-db-backed-services

## What this delivers

Real authentication: only `@getklar.com` Google accounts can sign in, the signed-in user is mapped to a roster `players` row, and the dev actor switcher is retired in favor of the real session. Admin gating uses the real `isAdmin` flag.

## Human action required (why it can't be automated)

- **Create a Google OAuth 2.0 Client** in Google Cloud Console (consent screen + credentials), restricted to the org, and copy the **Client ID/Secret**. This needs Google Workspace admin/owner access and cannot be scripted.
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.

## Layers touched

- `app/api/auth/[...nextauth]/route.ts` (NextAuth config)
- `lib/auth.ts` (`getCurrentPlayer()`, `requireAuth`, `requireAdmin`)
- `lib/authz.ts` (replace mock from slice 06)
- `components/Nav.tsx` (sign in/out; remove `DevActorSwitcher` in prod)
- `middleware.ts` (protect app + api routes)
- `.env.example`

## Tasks

### Auth wiring (code)
- [ ] Add NextAuth with the Google provider; in `signIn` callback, **reject any email not ending in `@getklar.com`**.
- [ ] On sign-in, match/create the session against the `players` row by email; deny if the email isn't on the active roster (or auto-create as inactive — pick per spec: deny is safer).
- [ ] `getCurrentPlayer()` resolves the session → `Player`; replace all `currentDevPlayerId` usages.
- [ ] `requireAdmin` now reads the real `players.isAdmin`.
- [ ] `middleware.ts` redirects unauthenticated users to sign-in; gate `/admin/**` to admins.
- [ ] Gate `DevActorSwitcher` behind `NODE_ENV !== 'production'` only (kept for local dev).

### Human-gated
- [ ] Create the OAuth client and set the four env vars (see Human action).

## Verifiable outcome

- A `@getklar.com` account can sign in and lands as the correct roster player.
- A non-getklar.com Google account is rejected at sign-in.
- Visiting any app/api route while signed out redirects to sign-in.
- `/admin/**` is reachable only by a player with `isAdmin = true`.
