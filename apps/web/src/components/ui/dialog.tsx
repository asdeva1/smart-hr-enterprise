'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal dialog on the native <dialog> element: focus is trapped and restored by the browser,
 * Escape closes it, and the rest of the page is inert while it is open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-lg border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-[#102028]/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-[17px] font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-[13px] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{open ? children : null}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
    </dialog>
  );
}
