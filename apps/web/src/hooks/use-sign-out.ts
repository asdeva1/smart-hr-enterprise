'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';

/** Ends the session on the server, clears cached data, and returns to the sign-in page. */
export function useSignOut() {
  const client = useQueryClient();
  const router = useRouter();
  return useCallback(
    async (everywhere = false) => {
      try {
        await apiFetch(everywhere ? '/v1/auth/logout-all' : '/v1/auth/logout', { method: 'POST' });
      } finally {
        client.clear();
        router.replace('/login?reason=signed-out');
      }
    },
    [client, router],
  );
}
