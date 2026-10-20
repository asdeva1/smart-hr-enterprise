'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage } from '@/lib/admin';
import { ApiError, apiBaseUrl, apiFetch, type SessionView } from '@/lib/api';
import {
  biometricKeys,
  OUTCOME_LABEL,
  useBiometricDevices,
  useBiometricLinks,
  useBiometricLogs,
  type BiometricDevice,
  type BiometricOutcome,
} from '@/lib/attendance';
import { AttendanceTabs } from '../attendance-tabs';

const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** A machine that has called in during the last ten minutes is "connected". */
const connected = (iso: string | null) => !!iso && Date.now() - new Date(iso).getTime() < 10 * 60_000;

function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.fieldErrors.length) {
      setErrors(Object.fromEntries(e.fieldErrors.map((f) => [f.path, f.message])));
    } else setFormError(errorMessage(e));
  };
  const reset = () => {
    setErrors({});
    setFormError(undefined);
  };
  return { errors, formError, onError, reset };
}

export function BiometricAdmin({ session }: { session: SessionView }) {
  const devices = useBiometricDevices();
  const links = useBiometricLinks();
  const [outcome, setOutcome] = useState('');
  const logs = useBiometricLogs(outcome);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState<string | null | false>(false);
  const [notice, setNotice] = useState<string>();
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ['attendance'] });

  const archive = useMutation({
    mutationFn: (d: BiometricDevice) =>
      apiFetch(`/v1/attendance/biometric/devices/${d.id}`, {
        method: 'PATCH',
        body: { status: d.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' },
      }),
    onSuccess: refresh,
  });
  const unlink = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/attendance/biometric/links/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const origin = typeof window === 'undefined' ? '' : (apiBaseUrl() || window.location.origin);
  const host = origin.replace(/^https?:\/\//, '');

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Fingerprint, face and card machines (eSSL and other ZKTeco-based devices) that send their scans here."
        actions={<Button onClick={() => setAdding(true)}>Add a machine</Button>}
      />
      <AttendanceTabs session={session} active="/attendance/biometric" />
      {notice && <Alert tone="success">{notice}</Alert>}

      <section aria-labelledby="bio-setup" className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <h2 id="bio-setup" className="text-base font-semibold">
          Connecting a machine
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-[#3e4c57]">
          <li>Add the machine here with the serial number shown on its screen (Menu → System Info).</li>
          <li>
            On the machine, open <b>Menu → Comm. → Cloud Server Setting</b> (ADMS) and set the server address
            to <code className="font-mono">{host || 'this site'}</code>, port <code className="font-mono">443</code>
            , with HTTPS on.
          </li>
          <li>
            Link each person’s <b>User ID</b> on the machine to their employee record below. Scans from numbers
            that aren’t linked yet are kept and counted once you link them.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          The first scan of a day is a clock-in, the next a clock-out, and so on, whatever the machine labels
          them. Machines that can only use plain HTTP can’t connect to a secure server.
        </p>
      </section>

      <h2 className="mt-2 text-lg font-semibold">Machines</h2>
      {devices.isPending ? (
        <Loading />
      ) : devices.isError ? (
        <Alert tone="error">{errorMessage(devices.error)}</Alert>
      ) : devices.data.devices.length === 0 ? (
        <Alert tone="info">No machines yet. Add one to start receiving scans.</Alert>
      ) : (
        <Table label="Biometric machines">
          <thead>
            <tr>
              <Th>Machine</Th>
              <Th>Serial number</Th>
              <Th>Time zone</Th>
              <Th>Last contact</Th>
              <Th>Last scan</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {devices.data.devices.map((d) => (
              <tr key={d.id}>
                <Td>
                  <span className="font-medium">{d.name}</span>
                  {d.location && <span className="block text-xs text-muted-foreground">{d.location}</span>}
                </Td>
                <Td className="font-mono text-xs">{d.serialNumber}</Td>
                <Td>{d.timeZone}</Td>
                <Td>
                  {d.status === 'ACTIVE' && connected(d.lastSeenAt) ? (
                    <Badge tone="success">Connected</Badge>
                  ) : (
                    <span className="text-sm">{stamp(d.lastSeenAt)}</span>
                  )}
                </Td>
                <Td className="text-sm">{stamp(d.lastPunchAt)}</Td>
                <Td>
                  <Badge tone={d.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {d.status === 'ACTIVE' ? 'Listening' : 'Archived'}
                  </Badge>
                  {d.unmapped > 0 && (
                    <span className="ml-2">
                      <Badge tone="warning">{d.unmapped} to link</Badge>
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" disabled={archive.isPending} onClick={() => archive.mutate(d)}>
                    {d.status === 'ACTIVE' ? 'Archive' : 'Restore'}
                    <span className="sr-only"> {d.name}</span>
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">User IDs and employees</h2>
        <Button variant="outline" onClick={() => setLinking(null)}>
          Link a user ID
        </Button>
      </div>
      {links.isPending ? (
        <Loading />
      ) : links.isError ? (
        <Alert tone="error">{errorMessage(links.error)}</Alert>
      ) : (
        <>
          {links.data.unlinked.length > 0 && (
            <Alert tone="warning">
              <span className="block font-medium">Scans from user IDs that aren’t linked to anyone yet</span>
              <span className="mt-1 flex flex-wrap gap-2">
                {links.data.unlinked.map((u) => (
                  <Button key={u.deviceCode} size="sm" variant="outline" onClick={() => setLinking(u.deviceCode)}>
                    ID {u.deviceCode} · {u.scans} scan{u.scans === 1 ? '' : 's'}
                  </Button>
                ))}
              </span>
            </Alert>
          )}
          {links.data.links.length === 0 ? (
            <Alert tone="info">No user IDs are linked to employees yet.</Alert>
          ) : (
            <Table label="Linked user IDs">
              <thead>
                <tr>
                  <Th>User ID on the machine</Th>
                  <Th>Employee</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {links.data.links.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-mono">{l.deviceCode}</Td>
                    <Td>
                      <span className="font-medium">{l.employee.name}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">{l.employee.code}</span>
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" disabled={unlink.isPending} onClick={() => unlink.mutate(l.id)}>
                        Unlink<span className="sr-only"> ID {l.deviceCode}</span>
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Recent scans</h2>
        <Select
          aria-label="Show"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="w-auto"
        >
          <option value="">All scans</option>
          {(Object.keys(OUTCOME_LABEL) as BiometricOutcome[]).map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABEL[o]}
            </option>
          ))}
        </Select>
      </div>
      {logs.isPending ? (
        <Loading />
      ) : logs.isError ? (
        <Alert tone="error">{errorMessage(logs.error)}</Alert>
      ) : logs.data.logs.length === 0 ? (
        <Alert tone="info">Nothing received yet.</Alert>
      ) : (
        <Table label="Recent scans">
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Machine</Th>
              <Th>User ID</Th>
              <Th>Employee</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {logs.data.logs.map((l) => (
              <tr key={l.id}>
                <Td className="tabular-nums">{stamp(l.punchedAt)}</Td>
                <Td>{l.device}</Td>
                <Td className="font-mono">{l.deviceCode}</Td>
                <Td>{l.employee ?? '—'}</Td>
                <Td>
                  <Badge tone={l.outcome === 'IMPORTED' ? 'success' : l.outcome === 'UNMAPPED' ? 'warning' : 'neutral'}>
                    {OUTCOME_LABEL[l.outcome]}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {adding && (
        <DeviceDialog
          onClose={() => setAdding(false)}
          onDone={(text) => {
            setNotice(text);
            setAdding(false);
          }}
        />
      )}
      {linking !== false && (
        <LinkDialog
          initialCode={linking ?? ''}
          onClose={() => setLinking(false)}
          onDone={(text) => {
            setNotice(text);
            setLinking(false);
          }}
        />
      )}
    </>
  );
}

function DeviceDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => void }) {
  const client = useQueryClient();
  const { errors, formError, onError, reset } = useFieldErrors();
  const [name, setName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [location, setLocation] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Kolkata');
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/v1/attendance/biometric/devices', {
        method: 'POST',
        body: { name, serialNumber, location, timeZone, vendor: 'ESSL' },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: biometricKeys.devices });
      onDone(`${name} is added. It will show as connected once it contacts the server.`);
    },
    onError,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a machine"
      description="Use the serial number printed on the machine or shown under System Info."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="device-form" disabled={save.isPending}>
            Add machine
          </Button>
        </>
      }
    >
      <form
        id="device-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="device-name" label="Name" error={errors.name}>
          <Input id="device-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front gate" />
        </Field>
        <Field id="device-serial" label="Serial number" error={errors.serialNumber}>
          <Input
            id="device-serial"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
            autoCapitalize="characters"
            className="font-mono"
          />
        </Field>
        <Field id="device-location" label="Location (optional)" error={errors.location}>
          <Input id="device-location" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field id="device-tz" label="Time zone of the machine’s clock" error={errors.timeZone}>
          <Input id="device-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function LinkDialog({
  initialCode,
  onClose,
  onDone,
}: {
  initialCode: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const client = useQueryClient();
  const { errors, formError, onError, reset } = useFieldErrors();
  const [deviceCode, setDeviceCode] = useState(initialCode);
  const [employee, setEmployee] = useState<{ id: string; name: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ imported: number }>('/v1/attendance/biometric/links', {
        method: 'POST',
        body: { deviceCode, employeeId: employee?.id ?? '' },
      }),
    onSuccess: async (r) => {
      await client.invalidateQueries({ queryKey: ['attendance'] });
      onDone(
        `ID ${deviceCode} is linked to ${employee?.name ?? 'the employee'}.` +
          (r.imported ? ` ${r.imported} waiting scan${r.imported === 1 ? ' was' : 's were'} counted.` : ''),
      );
    },
    onError,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Link a user ID"
      description="The user ID is the number the person was enrolled with on the machine."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="link-form" disabled={save.isPending}>
            Link
          </Button>
        </>
      }
    >
      <form
        id="link-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          reset();
          save.mutate();
        }}
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="link-code" label="User ID on the machine" error={errors.deviceCode}>
          <Input
            id="link-code"
            value={deviceCode}
            onChange={(e) => setDeviceCode(e.target.value)}
            inputMode="numeric"
            className="font-mono"
          />
        </Field>
        <Field id="link-employee" label="Employee" error={errors.employeeId}>
          <EmployeePicker id="link-employee" value={employee} onChange={setEmployee} invalid={!!errors.employeeId} />
        </Field>
      </form>
    </Dialog>
  );
}
