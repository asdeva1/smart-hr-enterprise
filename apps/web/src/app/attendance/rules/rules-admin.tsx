'use client';

import { attendancePolicySchema, updateWorkLocationSchema } from '@smart-hr/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, fieldAria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiFetch, type SessionView } from '@/lib/api';
import {
  advancedKeys,
  useLocations,
  usePolicy,
  type AttendancePolicy,
  type WorkLocationRow,
} from '@/lib/attendance-advanced';
import { AttendanceTabs } from '../attendance-tabs';

export function RulesAdmin({ session }: { session: SessionView }) {
  const policy = usePolicy();
  return (
    <>
      <PageHeader
        title="Attendance"
        description="How overtime is counted, how far back people may correct their own days, and where they may clock in from."
      />
      <AttendanceTabs session={session} active="/attendance/rules" />
      {policy.isPending ? (
        <Loading />
      ) : policy.isError ? (
        <Alert tone="error">{errorMessage(policy.error)}</Alert>
      ) : (
        <>
          <PolicyForm initial={policy.data} />
          <Locations />
        </>
      )}
    </>
  );
}

const toNumber = (v: string): number | null => (v.trim() === '' ? null : Number(v));

function PolicyForm({ initial }: { initial: AttendancePolicy }) {
  const client = useQueryClient();
  const [f, setF] = useState({
    overtimeEnabled: initial.overtimeEnabled,
    overtimeThresholdMinutes: String(initial.overtimeThresholdMinutes),
    overtimeRoundMinutes: String(initial.configured ? initial.overtimeRoundMinutes : 15),
    overtimeDailyCapMinutes:
      initial.overtimeDailyCapMinutes === null ? '' : String(initial.overtimeDailyCapMinutes),
    overtimeOffDayCounts: initial.overtimeOffDayCounts,
    overtimeNeedsApproval: initial.configured ? initial.overtimeNeedsApproval : true,
    maxCorrectionsPerMonth:
      initial.maxCorrectionsPerMonth === null ? '' : String(initial.maxCorrectionsPerMonth),
    maxCorrectionBackdateDays:
      initial.maxCorrectionBackdateDays === null ? '' : String(initial.maxCorrectionBackdateDays),
    geofenceMode: initial.geofenceMode,
  });
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [error, setError] = useState<string>();
  const set = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) =>
    setF((p) => ({ ...p, [key]: value }));
  const save = useMutation({
    mutationFn: (body: object) => apiFetch('/v1/attendance/policy', { method: 'PUT', body }),
    onSuccess: async () => {
      setError(undefined);
      setNotice({
        tone: 'success',
        text: 'Rules saved. They apply to new punches and recalculate on new days.',
      });
      await client.invalidateQueries({ queryKey: advancedKeys.policy });
    },
    onError: (e) => setNotice({ tone: 'error', text: errorMessage(e) }),
  });
  const submit = () => {
    setNotice(undefined);
    const parsed = attendancePolicySchema.safeParse({
      overtimeEnabled: f.overtimeEnabled,
      overtimeThresholdMinutes: Number(f.overtimeThresholdMinutes),
      overtimeRoundMinutes: Number(f.overtimeRoundMinutes),
      overtimeDailyCapMinutes: toNumber(f.overtimeDailyCapMinutes),
      overtimeOffDayCounts: f.overtimeOffDayCounts,
      overtimeNeedsApproval: f.overtimeNeedsApproval,
      maxCorrectionsPerMonth: toNumber(f.maxCorrectionsPerMonth),
      maxCorrectionBackdateDays: toNumber(f.maxCorrectionBackdateDays),
      geofenceMode: f.geofenceMode,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the numbers');
      return;
    }
    setError(undefined);
    save.mutate(parsed.data);
  };
  return (
    <section
      className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5"
      aria-labelledby="rules-h"
    >
      <h2 id="rules-h" className="text-[15px] font-semibold">
        Rules
      </h2>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {!initial.configured && (
        <Alert tone="info">
          No rules saved yet, so overtime counts every minute beyond the day. Saving this form switches to the
          rules below.
        </Alert>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Overtime</legend>
        <Check
          id="ot-on"
          label="Count overtime"
          checked={f.overtimeEnabled}
          onChange={(v) => set('overtimeEnabled', v)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id="ot-threshold"
            label="Ignore the first (minutes)"
            hint="A buffer after the working day before overtime starts."
          >
            <Input
              id="ot-threshold"
              inputMode="numeric"
              value={f.overtimeThresholdMinutes}
              onChange={(e) => set('overtimeThresholdMinutes', e.target.value)}
            />
          </Field>
          <Field id="ot-round" label="Round down to" hint="For example 15 minutes.">
            <Select
              id="ot-round"
              value={f.overtimeRoundMinutes}
              onChange={(e) => set('overtimeRoundMinutes', e.target.value)}
            >
              {[1, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minute{m === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ot-cap" label="Most per day (minutes)" hint="Leave empty for no limit.">
            <Input
              id="ot-cap"
              inputMode="numeric"
              value={f.overtimeDailyCapMinutes}
              onChange={(e) => set('overtimeDailyCapMinutes', e.target.value)}
            />
          </Field>
        </div>
        <Check
          id="ot-off"
          label="Work on a weekly off or holiday counts as overtime"
          checked={f.overtimeOffDayCounts}
          onChange={(v) => set('overtimeOffDayCounts', v)}
        />
        <Check
          id="ot-approve"
          label="A manager or HR must approve overtime before it is payable"
          checked={f.overtimeNeedsApproval}
          onChange={(v) => set('overtimeNeedsApproval', v)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Corrections</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="cor-month"
            label="Most corrections per person each month"
            hint="Leave empty for no limit."
          >
            <Input
              id="cor-month"
              inputMode="numeric"
              value={f.maxCorrectionsPerMonth}
              onChange={(e) => set('maxCorrectionsPerMonth', e.target.value)}
            />
          </Field>
          <Field
            id="cor-back"
            label="How many days back"
            hint="0 means today only. Leave empty for no limit."
          >
            <Input
              id="cor-back"
              inputMode="numeric"
              value={f.maxCorrectionBackdateDays}
              onChange={(e) => set('maxCorrectionBackdateDays', e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          These limits apply to people correcting their own days. HR can still record a day for someone.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Clocking in from a place</legend>
        <Field
          id="geo-mode"
          label="When someone clocks in or out"
          hint="Only applies once you add at least one work location below. A browser can be fooled about its location, so treat this as a guide, not proof."
        >
          <Select
            id="geo-mode"
            value={f.geofenceMode}
            onChange={(e) => set('geofenceMode', e.target.value as typeof f.geofenceMode)}
          >
            <option value="OFF">Don’t ask for a location</option>
            <option value="WARN">Record the location and flag punches away from a work location</option>
            <option value="ENFORCE">Only allow clocking in at a work location</option>
          </Select>
        </Field>
      </fieldset>
      <div>
        <Button disabled={save.isPending} onClick={submit}>
          Save rules
        </Button>
      </div>
    </section>
  );
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Locations() {
  const locations = useLocations();
  const [editing, setEditing] = useState<WorkLocationRow | 'new' | null>(null);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="loc-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="loc-h" className="text-[15px] font-semibold">
          Work locations
        </h2>
        <Button variant="outline" onClick={() => setEditing('new')}>
          Add a location
        </Button>
      </div>
      {locations.isPending ? (
        <Loading />
      ) : locations.isError ? (
        <Alert tone="error">{errorMessage(locations.error)}</Alert>
      ) : locations.data.length === 0 ? (
        <EmptyState title="No work locations yet">
          Add your office or site to check where people clock in from.
        </EmptyState>
      ) : (
        <Table label="Work locations">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Position</Th>
              <Th>Radius</Th>
              <Th>State</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {locations.data.map((l) => (
              <tr key={l.id}>
                <Td>
                  <b>{l.name}</b>
                </Td>
                <Td className="tabular-nums">
                  {l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}
                </Td>
                <Td>{l.radiusMeters} m</Td>
                <Td>
                  <Badge tone={l.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {l.status === 'ACTIVE' ? 'In use' : 'Retired'}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <Button variant="outline" onClick={() => setEditing(l)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <LocationDialog location={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function LocationDialog({ location, onClose }: { location: WorkLocationRow | null; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(location?.name ?? '');
  const [lat, setLat] = useState(location ? String(location.latitude) : '');
  const [lng, setLng] = useState(location ? String(location.longitude) : '');
  const [radius, setRadius] = useState(String(location?.radiusMeters ?? 150));
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>(location?.status ?? 'ACTIVE');
  const [error, setError] = useState<string>();
  const [locating, setLocating] = useState(false);
  const save = useMutation({
    mutationFn: (body: object) =>
      location
        ? apiFetch(`/v1/attendance/locations/${location.id}`, { method: 'PATCH', body })
        : apiFetch('/v1/attendance/locations', { method: 'POST', body }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: advancedKeys.locations });
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.detail : errorMessage(e)),
  });
  const useHere = () => {
    setError(undefined);
    if (!('geolocation' in navigator)) {
      setError('This browser can’t share its location. Type the coordinates instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError(
          'We couldn’t get your location. Allow location access for this site, or type the coordinates.',
        );
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const submit = () => {
    const parsed = updateWorkLocationSchema.safeParse({
      name,
      latitude: Number(lat),
      longitude: Number(lng),
      radiusMeters: Number(radius),
      ...(location ? { status } : {}),
    });
    if (!parsed.success || lat.trim() === '' || lng.trim() === '') {
      setError(
        parsed.success
          ? 'Enter the latitude and longitude'
          : (parsed.error.issues[0]?.message ?? 'Check the values'),
      );
      return;
    }
    setError(undefined);
    save.mutate(parsed.data);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={location ? `Edit ${location.name}` : 'Add a work location'}
      description="People can clock in within the radius of this point."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            Save location
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <Field id="loc-name" label="Name">
          <Input {...fieldAria('loc-name')} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px] flex-1">
            <Field id="loc-lat" label="Latitude">
              <Input id="loc-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            </Field>
          </div>
          <div className="min-w-[140px] flex-1">
            <Field id="loc-lng" label="Longitude">
              <Input id="loc-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
            </Field>
          </div>
          <Button variant="outline" disabled={locating} onClick={useHere}>
            Use my current location
          </Button>
        </div>
        <Field
          id="loc-radius"
          label="Radius (metres)"
          hint="Allow for GPS drift: 100 to 200 m suits an office."
        >
          <Input
            id="loc-radius"
            inputMode="numeric"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
        </Field>
        {location && (
          <Field id="loc-status" label="State">
            <Select
              id="loc-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="ACTIVE">In use</option>
              <option value="ARCHIVED">Retired</option>
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
