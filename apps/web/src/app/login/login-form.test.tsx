import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => search,
}));

function json(status: number, body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

type FetchMock = ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

const signedIn = {
  user: {
    id: 'u1',
    email: 'asha@acme.in',
    displayName: 'Asha Rao',
    isPlatformAdmin: false,
    mfaEnabled: false,
  },
  mfaPending: false,
  activeTenant: {
    id: 't1',
    name: 'Acme',
    isTenantAdmin: false,
    status: 'ACTIVE',
    branding: { name: null, color: null, logoUrl: null },
  },
  memberships: [{ tenantId: 't1', name: 'Acme', isTenantAdmin: false }],
  deploymentMode: 'saas',
  expiresAt: '2030-01-01T00:00:00Z',
  absoluteExpiresAt: '2030-01-01T00:00:00Z',
};

let fetchMock: FetchMock;

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginForm />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockReset();
  search = new URLSearchParams();
  fetchMock = vi.fn<(url: string) => Promise<Response>>((url) =>
    url.endsWith('/v1/auth/session')
      ? json(401, { code: 'UNAUTHENTICATED', detail: 'Sign in' })
      : json(500, {}),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginForm', () => {
  it('validates fields before calling the API', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/login'))).toBe(false);
  });

  it('shows the API’s generic message on failure and clears the password', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/login')
        ? json(401, { code: 'INVALID_CREDENTIALS', detail: 'We couldn’t sign you in with those details.' })
        : json(401, { code: 'UNAUTHENTICATED', detail: 'x' }),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText('Work email'), 'asha@acme.in');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain('We couldn’t sign you in');
    expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes to the requested page after signing in, but never off-site', async () => {
    search = new URLSearchParams({ next: 'https://evil.example/steal' });
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/login') ? json(200, signedIn) : json(401, {}),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText('Work email'), 'asha@acme.in');
    await userEvent.type(screen.getByLabelText('Password'), 'correct password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('asks for the second factor when the account has it turned on', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/login')
        ? json(200, { ...signedIn, mfaPending: true, activeTenant: null, memberships: [] })
        : json(401, {}),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText('Work email'), 'asha@acme.in');
    await userEvent.type(screen.getByLabelText('Password'), 'correct password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeTruthy();
    expect(screen.getByLabelText('Verification code')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('explains why the user is back on the sign-in page', async () => {
    search = new URLSearchParams({ reason: 'expired' });
    renderForm();
    expect((await screen.findByRole('status')).textContent).toContain('Your session ended');
  });

  it('hands over to single sign-on only when the address uses it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    fetchMock.mockImplementation((url: string) =>
      url.includes('/v1/sso/discover?email=asha%40acme.in')
        ? json(200, { sso: true, organisation: 'Acme', enforced: false })
        : url.includes('/v1/sso/discover')
          ? json(200, { sso: false })
          : json(401, {}),
    );
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with single sign-on' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Enter your work email first');

    await userEvent.type(screen.getByLabelText('Work email'), 'ravi@other.in');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with single sign-on' }));
    expect((await screen.findByRole('alert')).textContent).toContain('isn’t set up');
    expect(assign).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('Work email'));
    await userEvent.type(screen.getByLabelText('Work email'), 'asha@acme.in');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with single sign-on' }));
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/v1/sso/start?email=asha%40acme.in&next=%2F'),
    );
  });

  it('explains a failed single sign-on', async () => {
    search = new URLSearchParams({ sso_error: 'no_access' });
    renderForm();
    expect((await screen.findByRole('status')).textContent).toContain('hasn’t been added');
  });
});
