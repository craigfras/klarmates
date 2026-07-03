"use client";

/**
 * RosterManager — admin view for managing the player roster and weekly absences.
 *
 * Rendering and input-gathering only: one editable row per player with
 * per-row Save and Remove actions, per-player Absent toggle, and an
 * add-player form at the bottom. On success it refreshes the route. On
 * failure it surfaces an error via role="alert". All business logic lives
 * behind the API — this view carries none.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalToast } from "@/components/Toast";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROSTER_ENDPOINT = "/api/admin/roster";
const ABSENCES_ENDPOINT = "/api/admin/week/absences";

const ACTION_UPSERT = "upsert";
const ACTION_DEACTIVATE = "deactivate";
const ACTION_RESOLVE_SLACK = "resolve_slack";

const SAVE_LABEL = "Save";
const SYNC_SLACK_LABEL = "Sync Slack IDs";
const REMOVE_LABEL = "Remove";
const REACTIVATE_LABEL = "Reactivate";
const ADD_PLAYER_LABEL = "Add player";

const NAME_LABEL = "Name";
const EMAIL_LABEL = "Email";
const SLACK_LABEL = "Slack id";
const ADMIN_LABEL = "Admin";
const ACTIVE_LABEL = "Active";
const ABSENT_LABEL = "Absent";

const NEW_PLAYER_NAME_LABEL = "New player name";
const NEW_PLAYER_EMAIL_LABEL = "New player email";

const SAVE_SUCCESS_TOAST = "Player saved";
const REMOVE_SUCCESS_TOAST = "Player removed";
const REACTIVATE_SUCCESS_TOAST = "Player reactivated";
const ABSENCE_SUCCESS_TOAST = "Absence updated";
const ADD_SUCCESS_TOAST = "Player added";
const SYNC_SLACK_SUCCESS_TOAST = "Slack ids synced";

// Pending-key prefixes identifying the single in-flight action.
const KEY_SAVE = "save";
const KEY_REMOVE = "remove";
const KEY_REACTIVATE = "reactivate";
const KEY_ABSENT = "absent";
const KEY_ADD = "add";
const KEY_RESOLVE_SLACK = "resolve-slack";

const keyFor = (prefix: string, playerId: string) => `${prefix}:${playerId}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RosterManagerProps = {
  players: Player[];
  absentPlayerIds: string[];
  weekId: string;
};

/** Per-row editable state, seeded from the player prop. */
type RowState = {
  name: string;
  email: string;
  slackUserId: string;
  isAdmin: boolean;
  active: boolean;
};

const seedRowState = (player: Player): RowState => ({
  name: player.name,
  email: player.email,
  slackUserId: player.slackUserId ?? "",
  isAdmin: player.isAdmin,
  active: player.active,
});

// ---------------------------------------------------------------------------
// Shared POST helper
// ---------------------------------------------------------------------------

type PostResult = { ok: true } | { ok: false; error: string };

async function post(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<PostResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return { ok: true };
  }

  const data = (await response.json()) as { error?: string };
  return { ok: false, error: data.error ?? DEFAULT_ERROR_MESSAGE };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RosterManager({ players, absentPlayerIds, weekId }: RosterManagerProps) {
  const router = useRouter();
  const toast = useOptionalToast();

  // --- State: per-row editable fields, absent set, error surface ----------
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(
    Object.fromEntries(players.map((p) => [p.id, seedRowState(p)])),
  );
  const [absentIds, setAbsentIds] = useState<Set<string>>(
    new Set(absentPlayerIds),
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // --- Props-sync effects: re-seed local state when server delivers new props
  useEffect(() => {
    setRowStates(Object.fromEntries(players.map((p) => [p.id, seedRowState(p)])));
  }, [players]);

  useEffect(() => {
    setAbsentIds(new Set(absentPlayerIds));
  }, [absentPlayerIds]);

  // --- New-player form state ---------------------------------------------
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // --- Row field update helper -------------------------------------------
  const updateRow = (playerId: string, patch: Partial<RowState>) => {
    setRowStates((prev) => ({
      ...prev,
      [playerId]: { ...prev[playerId], ...patch },
    }));
  };

  // --- Shared action runner: track in-flight key, post, refresh or error -
  const runAction = async (
    key: string,
    endpoint: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<boolean> => {
    setError(null);
    setPendingKey(key);
    try {
      const result = await post(endpoint, body);
      if (result.ok) {
        toast.success(successMessage);
        router.refresh();
        return true;
      }
      setError(result.error);
      toast.error(result.error);
      return false;
    } finally {
      setPendingKey(null);
    }
  };

  // --- Save (upsert) handler ---------------------------------------------
  const handleSave = (player: Player) => {
    const row = rowStates[player.id];
    void runAction(
      keyFor(KEY_SAVE, player.id),
      ROSTER_ENDPOINT,
      {
        action: ACTION_UPSERT,
        player: {
          id: player.id,
          name: row.name,
          email: row.email,
          slackUserId: row.slackUserId,
          isAdmin: row.isAdmin,
          active: row.active,
        },
      },
      SAVE_SUCCESS_TOAST,
    );
  };

  // --- Remove (deactivate) handler ---------------------------------------
  const handleRemove = (playerId: string) => {
    void runAction(
      keyFor(KEY_REMOVE, playerId),
      ROSTER_ENDPOINT,
      { action: ACTION_DEACTIVATE, playerId },
      REMOVE_SUCCESS_TOAST,
    );
  };

  // --- Reactivate handler ------------------------------------------------
  const handleReactivate = (player: Player) => {
    const row = rowStates[player.id] ?? seedRowState(player);
    void runAction(
      keyFor(KEY_REACTIVATE, player.id),
      ROSTER_ENDPOINT,
      {
        action: ACTION_UPSERT,
        player: {
          id: player.id,
          name: row.name,
          email: row.email,
          slackUserId: row.slackUserId,
          isAdmin: row.isAdmin,
          active: true,
        },
      },
      REACTIVATE_SUCCESS_TOAST,
    );
  };

  // --- Absent toggle handler ---------------------------------------------
  // Optimistically flips the absent flag, then rolls back if the POST fails.
  const handleAbsentToggle = async (playerId: string, checked: boolean) => {
    const previous = absentIds;
    const next = new Set(previous);
    if (checked) {
      next.add(playerId);
    } else {
      next.delete(playerId);
    }
    setAbsentIds(next);

    const succeeded = await runAction(
      keyFor(KEY_ABSENT, playerId),
      ABSENCES_ENDPOINT,
      { weekId, absentPlayerIds: Array.from(next) },
      ABSENCE_SUCCESS_TOAST,
    );

    if (!succeeded) {
      setAbsentIds(previous);
    }
  };

  // --- Resolve Slack ids handler (roster-wide backfill) ------------------
  const handleResolveSlack = () => {
    void runAction(
      KEY_RESOLVE_SLACK,
      ROSTER_ENDPOINT,
      { action: ACTION_RESOLVE_SLACK },
      SYNC_SLACK_SUCCESS_TOAST,
    );
  };

  // --- Add player handler ------------------------------------------------
  const handleAddPlayer = () => {
    const id = crypto.randomUUID();
    void runAction(
      KEY_ADD,
      ROSTER_ENDPOINT,
      {
        action: ACTION_UPSERT,
        player: {
          id,
          name: newName,
          email: newEmail,
          slackUserId: "",
          isAdmin: false,
          active: true,
        },
      },
      ADD_SUCCESS_TOAST,
    );
  };

  return (
    <div className="roster-manager">
      {/* --- Error surface --- */}
      {error && (
        <p className="roster-error" role="alert">
          {error}
        </p>
      )}

      {/* --- Roster-wide actions --- */}
      <div className="roster-toolbar">
        <Button
          type="button"
          className="roster-btn-slack"
          loading={pendingKey === KEY_RESOLVE_SLACK}
          onClick={handleResolveSlack}
        >
          {SYNC_SLACK_LABEL}
        </Button>
      </div>

      {/* --- Player rows --- */}
      <div className="roster-rows">
        {players.map((player) => {
          const row = rowStates[player.id] ?? seedRowState(player);
          return (
            <div
              key={player.id}
              role="row"
              aria-label={player.name}
              className={"roster-row" + (row.active ? "" : " is-inactive")}
            >
              {/* Text fields */}
              <label className="roster-field">
                <span className="roster-field-label">{NAME_LABEL}</span>
                <input
                  type="text"
                  aria-label={NAME_LABEL}
                  value={row.name}
                  onChange={(e) => updateRow(player.id, { name: e.target.value })}
                  className="roster-input"
                />
              </label>

              <label className="roster-field">
                <span className="roster-field-label">{EMAIL_LABEL}</span>
                <input
                  type="text"
                  aria-label={EMAIL_LABEL}
                  value={row.email}
                  onChange={(e) => updateRow(player.id, { email: e.target.value })}
                  className="roster-input"
                />
              </label>

              <label className="roster-field">
                <span className="roster-field-label">{SLACK_LABEL}</span>
                <input
                  type="text"
                  aria-label={SLACK_LABEL}
                  value={row.slackUserId}
                  onChange={(e) => updateRow(player.id, { slackUserId: e.target.value })}
                  className="roster-input roster-input-slack"
                />
              </label>

              {/* Checkboxes */}
              <label className="roster-check">
                <input
                  type="checkbox"
                  aria-label={ADMIN_LABEL}
                  checked={row.isAdmin}
                  onChange={(e) => updateRow(player.id, { isAdmin: e.target.checked })}
                />
                <span>{ADMIN_LABEL}</span>
              </label>

              <label className="roster-check">
                <input
                  type="checkbox"
                  aria-label={ACTIVE_LABEL}
                  checked={row.active}
                  onChange={(e) => updateRow(player.id, { active: e.target.checked })}
                />
                <span>{ACTIVE_LABEL}</span>
              </label>

              <label className="roster-check">
                <input
                  type="checkbox"
                  aria-label={ABSENT_LABEL}
                  checked={absentIds.has(player.id)}
                  onChange={(e) => void handleAbsentToggle(player.id, e.target.checked)}
                />
                <span>{ABSENT_LABEL}</span>
              </label>

              {/* Actions */}
              <div className="roster-actions">
                <Button
                  type="button"
                  className="roster-btn-save"
                  loading={pendingKey === keyFor(KEY_SAVE, player.id)}
                  onClick={() => handleSave(player)}
                >
                  {SAVE_LABEL}
                </Button>
                {row.active ? (
                  <Button
                    type="button"
                    className="roster-btn-remove"
                    loading={pendingKey === keyFor(KEY_REMOVE, player.id)}
                    onClick={() => handleRemove(player.id)}
                  >
                    {REMOVE_LABEL}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="roster-btn-reactivate"
                    loading={pendingKey === keyFor(KEY_REACTIVATE, player.id)}
                    onClick={() => handleReactivate(player)}
                  >
                    {REACTIVATE_LABEL}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* --- Add player section --- */}
      <div className="roster-add">
        <label className="roster-field">
          <span className="roster-field-label">{NEW_PLAYER_NAME_LABEL}</span>
          <input
            type="text"
            aria-label={NEW_PLAYER_NAME_LABEL}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="roster-input"
            placeholder="Name"
          />
        </label>

        <label className="roster-field">
          <span className="roster-field-label">{NEW_PLAYER_EMAIL_LABEL}</span>
          <input
            type="text"
            aria-label={NEW_PLAYER_EMAIL_LABEL}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="roster-input"
            placeholder="Email"
          />
        </label>

        <Button
          type="button"
          className="roster-btn-add"
          loading={pendingKey === KEY_ADD}
          onClick={handleAddPlayer}
        >
          {ADD_PLAYER_LABEL}
        </Button>
      </div>
    </div>
  );
}
