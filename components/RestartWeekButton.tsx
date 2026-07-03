"use client";

/**
 * RestartWeekButton — admin action to restart the current open week.
 *
 * Rendering + tiny state only (no business logic): POSTs { weekId } to the
 * restart endpoint, shows the shared Button's loading spinner while in flight,
 * raises a success toast and refreshes the route on success, and raises an
 * error toast (recovering the button) on failure.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { useOptionalToast } from "@/components/Toast";
import { DEFAULT_ERROR_MESSAGE } from "@/components/uiMessages";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESTART_ENDPOINT = "/api/admin/week/restart";
const RESTART_LABEL = "Restart week";
const RESTART_SUCCESS_TOAST = "Week restarted";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RestartWeekButtonProps = {
  weekId: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RestartWeekButton({ weekId }: RestartWeekButtonProps) {
  const router = useRouter();
  const toast = useOptionalToast();

  // --- State: single in-flight flag --------------------------------------
  const [pending, setPending] = useState(false);

  // --- Click handler: POST, toast, refresh; finally clears pending -------
  const handleClick = async () => {
    setPending(true);
    try {
      const response = await fetch(RESTART_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId }),
      });
      if (response.ok) {
        toast.success(RESTART_SUCCESS_TOAST);
        router.refresh();
      } else {
        toast.error(DEFAULT_ERROR_MESSAGE);
      }
    } catch {
      toast.error(DEFAULT_ERROR_MESSAGE);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      className="restart-week-btn"
      loading={pending}
      onClick={() => void handleClick()}
    >
      {RESTART_LABEL}
    </Button>
  );
}
