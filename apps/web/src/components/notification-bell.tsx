'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import { approvalKeys, useNotifications, type Notification } from '@/lib/approvals';
import { cn } from '@/lib/utils';

/** Header bell: unread count and the latest notifications. Opening one marks it read and follows its link. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const client = useQueryClient();
  const notifications = useNotifications();
  const unread = notifications.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/notifications/${id}/read`, { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: approvalKeys.notifications }),
  });
  const markAll = useMutation({
    mutationFn: () => apiFetch('/v1/notifications/read-all', { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: approvalKeys.notifications }),
  });

  function openNotification(n: Notification) {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-10 place-items-center rounded-md hover:bg-muted"
      >
        <Bell aria-hidden="true" className="size-5" strokeWidth={1.75} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 grid min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] leading-[18px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-20 mt-2 flex w-[min(380px,calc(100vw-32px))] flex-col rounded-lg border border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                className="text-[13px] text-primary hover:underline"
                onClick={() => markAll.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          {notifications.isPending ? (
            <p role="status" className="px-4 py-6 text-muted-foreground">
              Loading…
            </p>
          ) : notifications.isError || notifications.data.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted-foreground">
              {notifications.isError ? 'Notifications are unavailable right now.' : 'You’re all caught up.'}
            </p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {notifications.data.items.map((n) => (
                <li key={n.id} className="border-b border-muted last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted',
                      !n.readAt && 'bg-primary-soft/40',
                    )}
                  >
                    <span className={cn('text-sm', !n.readAt && 'font-semibold')}>
                      {!n.readAt && <span className="sr-only">Unread: </span>}
                      {n.title}
                    </span>
                    <span className="text-[13px] text-muted-foreground">{n.body}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
