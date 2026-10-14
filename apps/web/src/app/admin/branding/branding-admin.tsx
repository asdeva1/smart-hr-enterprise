'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { brandingSchema, contrastWithWhite, type BrandingInput } from '@smart-hr/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { applyFieldErrors, errorMessage } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { SESSION_KEY } from '@/lib/session';
import { initials } from '@/lib/utils';

interface Branding {
  brandName: string | null;
  brandColor: string | null;
  brandLogoUrl: string | null;
}

const BRANDING_KEY = ['tenant', 'branding'] as const;
const DEFAULT_COLOR = '#0e6b66';

export function BrandingAdmin({ session }: { session: SessionView }) {
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const branding = useQuery({
    queryKey: BRANDING_KEY,
    queryFn: () => apiFetch<Branding>('/v1/tenant/branding'),
  });
  const form = useForm<BrandingInput, unknown, z.output<typeof brandingSchema>>({
    resolver: zodResolver(brandingSchema),
    defaultValues: { brandName: '', brandColor: '', brandLogoUrl: '' },
  });
  useEffect(() => {
    if (branding.data) {
      form.reset({
        brandName: branding.data.brandName ?? '',
        brandColor: branding.data.brandColor ?? '',
        brandLogoUrl: branding.data.brandLogoUrl ?? '',
      });
    }
  }, [branding.data, form]);
  const save = useMutation({
    mutationFn: (body: z.output<typeof brandingSchema>) =>
      apiFetch<Branding>('/v1/tenant/branding', { method: 'PUT', body }),
    onSuccess: async (data) => {
      setNotice({ tone: 'success', text: 'Branding saved. Everyone sees it the next time a page loads.' });
      client.setQueryData(BRANDING_KEY, data);
      await client.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: (e) => {
      if (!applyFieldErrors(e, form.setError)) setNotice({ tone: 'error', text: errorMessage(e) });
    },
  });
  const errors = form.formState.errors;
  const [watchedName, watchedColor] = useWatch({ control: form.control, name: ['brandName', 'brandColor'] });
  const name = text(watchedName);
  const color = text(watchedColor).toLowerCase();
  const previewColor =
    /^#[0-9a-f]{6}$/.test(color) && contrastWithWhite(color) >= 4.5 ? color : DEFAULT_COLOR;
  const readOnly = session.activeTenant?.status === 'OFFBOARDING';

  return (
    <>
      <PageHeader
        title="Branding"
        description="The name, colour and logo everyone in your organisation sees in the app and in emails."
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {branding.isPending ? (
        <Loading />
      ) : branding.isError ? (
        <Alert tone="error">{errorMessage(branding.error)}</Alert>
      ) : (
        <div className="flex flex-wrap gap-6">
          <form
            noValidate
            className="flex flex-[1_1_320px] flex-col gap-4 rounded-lg border border-border bg-card p-6"
            onSubmit={form.handleSubmit((v) => {
              setNotice(undefined);
              save.mutate(v);
            })}
          >
            <Field
              id="brand-name"
              label="Display name"
              error={errors.brandName?.message}
              hint={`Leave empty to use “${session.activeTenant?.name ?? ''}”.`}
            >
              <Input
                {...fieldAria('brand-name', errors.brandName?.message, 'hint')}
                {...form.register('brandName')}
              />
            </Field>
            <Field
              id="brand-color"
              label="Main colour"
              error={errors.brandColor?.message}
              hint="A hex colour dark enough for white text on top, e.g. #1d4ed8. Leave empty for the default."
            >
              <div className="flex items-center gap-2">
                <Input
                  className="font-mono"
                  {...fieldAria('brand-color', errors.brandColor?.message, 'hint')}
                  {...form.register('brandColor')}
                />
                <span
                  aria-hidden="true"
                  className="size-9 shrink-0 rounded-md border border-border"
                  style={{ background: previewColor }}
                />
              </div>
            </Field>
            <Field
              id="brand-logo"
              label="Logo address"
              error={errors.brandLogoUrl?.message}
              hint="An https:// link to a square image. Leave empty to show initials."
            >
              <Input
                type="url"
                {...fieldAria('brand-logo', errors.brandLogoUrl?.message, 'hint')}
                {...form.register('brandLogoUrl')}
              />
            </Field>
            <div>
              <Button type="submit" disabled={save.isPending || readOnly}>
                Save branding
              </Button>
            </div>
          </form>
          <section
            aria-labelledby="preview-heading"
            className="flex flex-[1_1_260px] flex-col gap-3 rounded-lg border border-border bg-card p-6"
          >
            <h2 id="preview-heading" className="font-semibold">
              Preview
            </h2>
            <div className="flex items-center gap-2.5 rounded-md bg-sidebar px-3 py-3 text-[15px] font-bold text-white">
              <span
                className="grid size-[30px] place-items-center rounded-md font-mono text-[13px]"
                style={{ background: previewColor }}
              >
                {initials(name || session.activeTenant?.name || 'SH')}
              </span>
              {name || session.activeTenant?.name}
            </div>
            <div>
              <span
                className="inline-flex h-9 items-center rounded-md px-4 text-sm font-semibold text-white"
                style={{ background: previewColor }}
              >
                Example button
              </span>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
