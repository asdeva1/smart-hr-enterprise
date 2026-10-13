'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { errorMessage, timeZones } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';
import { configKeys, useConfiguration, type SettingView } from '@/lib/configuration';

const GROUPS = ['Locale', 'Finance', 'People'] as const;

export function SettingsAdmin() {
  const settings = useConfiguration();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <Alert tone="error">{errorMessage(settings.error)}</Alert>;
  return <SettingsForm settings={settings.data} />;
}

function SettingsForm({ settings }: { settings: SettingView[] }) {
  const client = useQueryClient();
  const zones = useMemo(() => timeZones(), []);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(settings.map((s) => [s.key, String(s.value)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const changed = settings.filter((s) => draft[s.key] !== String(s.value));

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ changed: string[]; values: Record<string, string | number> }>('/v1/tenant/configuration', {
        method: 'PUT',
        body: { values: Object.fromEntries(changed.map((s) => [s.key, draft[s.key]])) },
      }),
    onSuccess: async (data) => {
      setErrors({});
      setNotice({
        tone: 'success',
        text: data.changed.length === 0 ? 'Nothing changed.' : `Saved ${data.changed.length} setting(s).`,
      });
      // Show values as the server stored them (e.g. upper-case currency).
      setDraft(Object.fromEntries(Object.entries(data.values).map(([k, v]) => [k, String(v)])));
      await client.invalidateQueries({ queryKey: configKeys.settings });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path.replace(/^values\./, ''), f.message])));
        setNotice({ tone: 'error', text: 'Some settings need attention.' });
      } else {
        setNotice({ tone: 'error', text: errorMessage(e) });
      }
    },
  });

  function control(s: SettingView) {
    const id = `setting-${s.key}`;
    const common = {
      ...fieldAria(id, errors[s.key]),
      value: draft[s.key] ?? '',
      onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [s.key]: e.target.value })),
    };
    if (s.input.type === 'select') {
      return (
        <Select {...common}>
          {s.input.options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    if (s.input.type === 'timezone') {
      return (
        <Select {...common}>
          {(zones.includes(common.value) ? zones : [common.value, ...zones]).map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
      );
    }
    return <Input {...common} {...(s.input.placeholder ? { placeholder: s.input.placeholder } : {})} />;
  }

  return (
    <>
      <PageHeader
        title="Organisation settings"
        description="Defaults that apply across Smart HR. Companies can override time zone and currency."
      />
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(undefined);
          if (changed.length === 0) return setNotice({ tone: 'success', text: 'Nothing changed.' });
          save.mutate();
        }}
      >
        {GROUPS.map((group) => (
          <section
            key={group}
            aria-labelledby={`group-${group}`}
            className="rounded-lg border border-border bg-card p-6"
          >
            <h2 id={`group-${group}`} className="text-[17px] font-semibold">
              {group}
            </h2>
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
              {settings
                .filter((s) => s.group === group)
                .map((s) => (
                  <Field
                    key={s.key}
                    id={`setting-${s.key}`}
                    label={s.label}
                    error={errors[s.key]}
                    hint={s.description}
                  >
                    {control(s)}
                  </Field>
                ))}
            </div>
          </section>
        ))}
        <div className="flex gap-2.5">
          <Button type="submit" disabled={save.isPending}>
            Save settings
          </Button>
          <Button
            variant="outline"
            disabled={changed.length === 0}
            onClick={() => {
              setDraft(Object.fromEntries(settings.map((s) => [s.key, String(s.value)])));
              setErrors({});
            }}
          >
            Discard changes
          </Button>
        </div>
      </form>
    </>
  );
}
