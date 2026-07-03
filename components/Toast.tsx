"use client";

/**
 * Toast — app-wide transient notifications.
 *
 * A small context-based toast system: feature components call useToast() to
 * raise success/error messages, and a single <ToastViewport/> (mounted once in
 * the root layout) renders the active toasts in a polite live region. Toasts
 * auto-dismiss after TOAST_DURATION_MS and can be dismissed manually.
 *
 * Rendering + tiny state only — no business logic.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOAST_DURATION_MS = 4000;

const REGION_LABEL = "Notifications";
const DISMISS_LABEL = "Dismiss";

const VARIANT_SUCCESS = "success";
const VARIANT_ERROR = "error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToastVariant = typeof VARIANT_SUCCESS | typeof VARIANT_ERROR;

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toasts: Toast[];
  add: (message: string, variant: ToastVariant) => void;
  remove: (id: number) => void;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: React.ReactNode }) {
  // --- Active toast list + a stable, render-safe id counter --------------
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const add = useCallback((message: string, variant: ToastVariant) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((previous) => [...previous, { id, message, variant }]);
  }, []);

  // --- Stable context value so consumers don't churn --------------------
  const value = useMemo<ToastContextValue>(
    () => ({ toasts, add, remove }),
    [toasts, add, remove],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const NO_OP = () => {};
const NO_OP_TOAST: ToastApi = { success: NO_OP, error: NO_OP };

/** Strict accessor — throws when used outside a <ToastProvider>. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("useToast() must be called inside a <ToastProvider>.");
  }
  return useToastApi(context.add);
}

/**
 * Forgiving accessor — returns a no-op API when there is no provider, so a
 * component can be rendered (e.g. in isolation) without a ToastProvider.
 */
export function useOptionalToast(): ToastApi {
  const context = useContext(ToastContext);
  // useToastApi already degrades to a no-op when `add` is absent, so we can
  // return its result directly (the hook is always called → Hooks-rules-safe).
  return useToastApi(context?.add);
}

/** Builds the stable success/error API from a (possibly absent) add fn. */
function useToastApi(add?: ToastContextValue["add"]): ToastApi {
  return useMemo<ToastApi>(() => {
    if (!add) {
      return NO_OP_TOAST;
    }
    return {
      success: (message: string) => add(message, VARIANT_SUCCESS),
      error: (message: string) => add(message, VARIANT_ERROR),
    };
  }, [add]);
}

// ---------------------------------------------------------------------------
// Single toast card (owns its own auto-dismiss timer)
// ---------------------------------------------------------------------------

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  // --- Auto-dismiss after the configured duration, keyed on this toast --
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className="toast" role="status" data-variant={toast.variant}>
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        aria-label={DISMISS_LABEL}
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export function ToastViewport() {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error("<ToastViewport/> must be rendered inside a <ToastProvider>.");
  }

  const { toasts, remove } = context;

  return (
    <div
      className="toast-viewport"
      role="region"
      aria-live="polite"
      aria-label={REGION_LABEL}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={remove} />
      ))}
    </div>
  );
}
