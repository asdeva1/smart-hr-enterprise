'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, type SessionView } from './api';

export const SESSION_KEY = ['auth', 'session'] as const;

/**
 * The signed-in session, or null when signed out or expired. This is for display and navigation only:
 * the API checks the session on every request regardless of what the browser believes.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<SessionView | null> => {
      try {
        return await apiFetch<SessionView>('/v1/auth/session');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

/** Stores a session view returned by sign-in, MFA or tenant switch, so pages update without a refetch. */
export function useSetSession() {
  const client = useQueryClient();
  return (view: SessionView | null) => client.setQueryData(SESSION_KEY, view);
}
