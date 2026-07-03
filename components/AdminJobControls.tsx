"use client";

/**
 * AdminJobControls — manual triggers for the scheduled (cron) jobs, rendered as
 * a vertical operations timeline.
 *
 * Rendering and input-gathering only: four operations that each POST (no body)
 * to their matching admin manual-trigger endpoint, bypassing cron timing. Safe
 * operations POST immediately; destructive ones gate the POST behind a
 * ConfirmDialog. On success it refreshes the route, shows a success toast and
 * renders a per-operation inline result summary; on failure it surfaces the
 * server error via role="alert" scoped to that operation's row and does not
 * refresh. All game rules live behind the API — this view carries none.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useOptionalToast } from "@/components/Toast";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";

// ---------------------------------------------------------------------------
// Constants — endpoints
// ---------------------------------------------------------------------------

const DRAFT_ENDPOINT = "/api/admin/jobs/draft-week";
const REMINDER_ENDPOINT = "/api/admin/jobs/reminder";
const CLOSE_ENDPOINT = "/api/admin/jobs/close-week";
const ROLLOVER_ENDPOINT = "/api/admin/jobs/season-rollover";

// ---------------------------------------------------------------------------
// Constants — trigger labels (destructive confirm labels reuse the trigger)
// ---------------------------------------------------------------------------

const DRAFT_LABEL = "Draft next week";
const REMINDER_LABEL = "Send reminders";
const CLOSE_LABEL = "Close current week";
const ROLLOVER_LABEL = "Roll over season";

// ---------------------------------------------------------------------------
// Constants — pending keys (one in-flight action at a time)
// ---------------------------------------------------------------------------

const KEY_DRAFT = "draft";
const KEY_REMINDER = "reminder";
const KEY_CLOSE = "close";
const KEY_ROLLOVER = "rollover";

// ---------------------------------------------------------------------------
// Constants — toast copy
// ---------------------------------------------------------------------------

const SUCCESS_TOAST = "Job triggered";

// ---------------------------------------------------------------------------
// Constants — inline result copy
// ---------------------------------------------------------------------------

const WEEK_CLOSED_RESULT = "Week closed and results sent";
const NO_OPEN_WEEK_RESULT = "No open week to close";
const SEASON_ROLLED_RESULT = "Season rolled over";
const NO_SEASON_RESULT = "No current season to roll over";

const draftedResult = (count: number) => `Drafted ${count} questions`;
const remindedResult = (count: number) => `Reminded ${count} players`;

// ---------------------------------------------------------------------------
// Constants — destructive confirmation copy
// ---------------------------------------------------------------------------

const CLOSE_CONFIRM_BODY =
  "This ends the current week and sends everyone their results. It can't be undone.";
const ROLLOVER_CONFIRM_BODY =
  "This archives the current season and starts a fresh one. It can't be undone.";

// ---------------------------------------------------------------------------
// Action descriptors
// ---------------------------------------------------------------------------

/** The shape of each success response body a per-action summariser reads. */
type JobResult = {
  questionCount?: number;
  sent?: number;
  closed?: boolean;
  rolledOver?: boolean;
};

/** One operation's identity, endpoint, danger flag and result formatter. */
type JobAction = {
  key: string;
  testId: string;
  label: string;
  description: string;
  endpoint: string;
  destructive: boolean;
  /** Only present for destructive actions — the warning dialog's body copy. */
  confirmBody?: string;
  /** Pure formatting of a success body into the inline result string. */
  describeResult: (data: JobResult) => string;
};

const JOB_ACTIONS: ReadonlyArray<JobAction> = [
  {
    key: KEY_DRAFT,
    testId: "job-draft",
    label: DRAFT_LABEL,
    description: "Generate next week's draft questions ahead of the cron run.",
    endpoint: DRAFT_ENDPOINT,
    destructive: false,
    describeResult: (data) => draftedResult(data.questionCount ?? 0),
  },
  {
    key: KEY_REMINDER,
    testId: "job-reminder",
    label: REMINDER_LABEL,
    description: "Nudge players who still have unanswered questions this week.",
    endpoint: REMINDER_ENDPOINT,
    destructive: false,
    describeResult: (data) => remindedResult(data.sent ?? 0),
  },
  {
    key: KEY_CLOSE,
    testId: "job-close",
    label: CLOSE_LABEL,
    description: "Lock answers, score the week and send everyone their results.",
    endpoint: CLOSE_ENDPOINT,
    destructive: true,
    confirmBody: CLOSE_CONFIRM_BODY,
    describeResult: (data) =>
      data.closed === true ? WEEK_CLOSED_RESULT : NO_OPEN_WEEK_RESULT,
  },
  {
    key: KEY_ROLLOVER,
    testId: "job-rollover",
    label: ROLLOVER_LABEL,
    description: "Archive the current season and open a fresh one.",
    endpoint: ROLLOVER_ENDPOINT,
    destructive: true,
    confirmBody: ROLLOVER_CONFIRM_BODY,
    describeResult: (data) =>
      data.rolledOver === true ? SEASON_ROLLED_RESULT : NO_SEASON_RESULT,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminJobControls() {
  const router = useRouter();
  const toast = useOptionalToast();

  // --- State: single in-flight key, per-row results + errors, open dialog -
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const setRowResult = (key: string, value: string) =>
    setResults((previous) => ({ ...previous, [key]: value }));
  const setRowError = (key: string, value: string) =>
    setErrors((previous) => ({ ...previous, [key]: value }));

  // --- Shared flow: POST, parse, ok→result+refresh+toast / error→alert ---
  const runAction = async (action: JobAction): Promise<void> => {
    setPendingKey(action.key);
    setErrors((previous) => ({ ...previous, [action.key]: "" }));
    setResults((previous) => ({ ...previous, [action.key]: "" }));
    try {
      const response = await fetch(action.endpoint, { method: "POST" });
      const data = (await response.json()) as JobResult & { error?: string };

      if (response.ok) {
        setRowResult(action.key, action.describeResult(data));
        toast.success(SUCCESS_TOAST);
        router.refresh();
      } else {
        const message = data.error ?? DEFAULT_ERROR_MESSAGE;
        setRowError(action.key, message);
        toast.error(message);
      }
    } finally {
      setPendingKey(null);
    }
  };

  // --- Trigger handler: safe → POST now; destructive → open the dialog ---
  const handleTrigger = (action: JobAction) => {
    if (action.destructive) {
      setConfirmKey(action.key);
      return;
    }
    void runAction(action);
  };

  // --- Confirm handler: POST the pending destructive action then close ---
  const confirmAction = JOB_ACTIONS.find((action) => action.key === confirmKey);
  const handleConfirm = async () => {
    if (!confirmAction) {
      return;
    }
    await runAction(confirmAction);
    setConfirmKey(null);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="admin-job-controls">
      {/* --- The four operations as a dotted-spine timeline --- */}
      <ol className="admin-job-list">
        {JOB_ACTIONS.map((action, index) => (
          <li
            className={`admin-job-row${action.destructive ? " is-destructive" : ""}`}
            data-testid={action.testId}
            key={action.key}
          >
            {/* --- Step node marker --- */}
            <span className="admin-job-node mono" aria-hidden="true">
              {index + 1}
            </span>

            {/* --- Text block: title + one-line description + feedback --- */}
            <div className="admin-job-text">
              <p className="admin-job-title">{action.label}</p>
              <p className="admin-job-desc">{action.description}</p>
              {results[action.key] && (
                <p className="admin-job-result">{results[action.key]}</p>
              )}
              {errors[action.key] && (
                <p className="admin-job-error" role="alert">
                  {errors[action.key]}
                </p>
              )}
            </div>

            {/* --- Trigger button --- */}
            <Button
              type="button"
              className={
                action.destructive ? "admin-job-btn-danger" : "admin-job-btn"
              }
              loading={pendingKey === action.key && !action.destructive}
              onClick={() => handleTrigger(action)}
            >
              {action.label}
            </Button>
          </li>
        ))}
      </ol>

      {/* --- Single shared confirm dialog for whichever destructive
             operation is armed. --- */}
      <ConfirmDialog
        open={confirmAction !== undefined}
        title={confirmAction?.label ?? ""}
        confirmLabel={confirmAction?.label ?? ""}
        confirming={confirmAction !== undefined && pendingKey === confirmAction.key}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setConfirmKey(null)}
      >
        {confirmAction?.confirmBody}
      </ConfirmDialog>
    </div>
  );
}
