"use client";

/**
 * Modal — a small accessible dialog with a single OK action.
 *
 * Rendering only: when closed it renders nothing; when open it renders a
 * backdrop + a labelled dialog whose body is the supplied children and whose
 * sole control is an OK button (the shared Button). Focus moves to OK on open,
 * and Escape mirrors the OK action. No business logic lives here.
 */

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/Button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OK_LABEL = "OK";
const ESCAPE_KEY = "Escape";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ModalProps = {
  open: boolean;
  title: string;
  onOk: () => void;
  okLabel?: string;
  children: React.ReactNode;
};

export function Modal({
  open,
  title,
  onOk,
  okLabel = DEFAULT_OK_LABEL,
  children,
}: ModalProps) {
  const titleId = useId();
  const okRef = useRef<HTMLButtonElement>(null);

  // --- Move focus to OK when the dialog opens --------------------------
  useEffect(() => {
    if (open) {
      okRef.current?.focus();
    }
  }, [open]);

  // --- Escape mirrors the OK action while open -------------------------
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ESCAPE_KEY) {
        onOk();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOk]);

  if (!open) {
    return null;
  }

  // --- Render: backdrop + labelled dialog ------------------------------
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 className="modal-title" id={titleId}>
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <Button
          ref={okRef}
          type="button"
          className="modal-ok-btn"
          onClick={onOk}
        >
          {okLabel}
        </Button>
      </div>
    </div>
  );
}
