'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvalPolicyDefinitionSchema,
  decimalString,
  type ApprovalPolicyDefinition,
  type ApprovalStage,
  type ApproverRule,
} from '@smart-hr/validation';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Loading, PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, Td, Th } from '@/components/ui/table';
import { errorMessage, formatDateTime, usePermissionCatalogue, useRoles } from '@/lib/admin';
import { apiFetch, type SessionView } from '@/lib/api';
import { approvalKeys, formatAmount, type Colleague, type PolicySummary } from '@/lib/approvals';
import { can } from '@/lib/permissions';

export function PoliciesAdmin({ session }: { session: SessionView }) {
  const [editing, setEditing] = useState<PolicySummary>();
  const [notice, setNotice] = useState<string>();
  const policies = useQuery({
    queryKey: approvalKeys.policies,
    queryFn: () => apiFetch<PolicySummary[]>('/v1/approvals/policies'),
  });

  return (
    <>
      <PageHeader
        title="Approval policies"
        description="Who approves each kind of request. Publishing creates a new version; requests already in progress keep theirs."
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {policies.isPending ? (
        <Loading />
      ) : policies.isError ? (
        <Alert tone="error">{errorMessage(policies.error)}</Alert>
      ) : (
        <Table label="Approval policies">
          <thead>
            <tr>
              <Th>Request type</Th>
              <Th>Module</Th>
              <Th>Approval route</Th>
              <Th>Version</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {policies.data.map((p) => (
              <tr key={p.subjectType}>
                <Td className="font-medium">{p.label}</Td>
                <Td>{p.module}</Td>
                <Td>
                  {p.active ? (
                    <span className="text-[13px]">
                      {p.active.definition.stages.map((s) => s.name).join(' → ')}
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">
                      Default — organisation owners approve
                    </span>
                  )}
                </Td>
                <Td>
                  {p.active ? (
                    <span title={`Published ${formatDateTime(p.active.createdAt)}`}>v{p.active.version}</span>
                  ) : (
                    <Badge>Default</Badge>
                  )}
                </Td>
                <Td className="text-right">
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                    Edit<span className="sr-only"> {p.label} policy</span>
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <PolicyEditor
          key={editing.subjectType}
          policy={editing}
          canPickRoles={can(session, 'access.view')}
          onClose={() => setEditing(undefined)}
          onPublished={(version) => {
            setNotice(`${editing.label}: version ${version} published.`);
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}

const DEFAULT_STAGE: ApprovalStage = { name: 'Approval', mode: 'ANY', approvers: [{ type: 'OWNERS' }] };

function PolicyEditor({
  policy,
  canPickRoles,
  onClose,
  onPublished,
}: {
  policy: PolicySummary;
  canPickRoles: boolean;
  onClose: () => void;
  onPublished: (version: number) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(policy.active?.name ?? `${policy.label} approvals`);
  const [definition, setDefinition] = useState<ApprovalPolicyDefinition>(
    policy.active?.definition ?? { stages: [DEFAULT_STAGE], distinctApprovers: true },
  );
  const [problems, setProblems] = useState<string[]>([]);
  const roles = useRoles();
  const permissions = usePermissionCatalogue();
  const colleagues = useQuery({
    queryKey: approvalKeys.colleagues(''),
    queryFn: () => apiFetch<Colleague[]>('/v1/approvals/colleagues'),
  });

  const publish = useMutation({
    mutationFn: (parsed: ApprovalPolicyDefinition) =>
      apiFetch<{ id: string; version: number }>('/v1/approvals/policies', {
        method: 'POST',
        body: { subjectType: policy.subjectType, name, definition: parsed },
      }),
    onSuccess: async (data) => {
      await client.invalidateQueries({ queryKey: approvalKeys.policies });
      onPublished(data.version);
    },
    onError: (e) => setProblems([errorMessage(e)]),
  });

  const setStage = (index: number, patch: Partial<ApprovalStage>) =>
    setDefinition((d) => ({ ...d, stages: d.stages.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));

  function submit() {
    const parsed = approvalPolicyDefinitionSchema.safeParse(definition);
    if (!parsed.success) {
      setProblems(
        parsed.error.issues.map((issue) => {
          const [, stage] = issue.path;
          return typeof stage === 'number' ? `Stage ${stage + 1}: ${issue.message}` : issue.message;
        }),
      );
      return;
    }
    if (name.trim().length < 2) {
      setProblems(['Name the policy']);
      return;
    }
    setProblems([]);
    publish.mutate(parsed.data);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${policy.label} approvals`}
      description="Stages run in order. Approvers are worked out when each stage starts."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={publish.isPending}>
            Publish new version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {problems.length > 0 && (
          <Alert tone="error">
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Field id="policy-name" label="Policy name">
          <Input id="policy-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        {definition.stages.map((stage, index) => (
          <fieldset key={index} className="flex flex-col gap-3 rounded-md border border-border p-4">
            <legend className="px-1 text-[13px] font-semibold">Stage {index + 1}</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
              <Field id={`stage-${index}-name`} label="Stage name">
                <Input
                  id={`stage-${index}-name`}
                  value={stage.name}
                  onChange={(e) => setStage(index, { name: e.target.value })}
                />
              </Field>
              <Field id={`stage-${index}-mode`} label="Who must approve">
                <Select
                  id={`stage-${index}-mode`}
                  value={stage.mode}
                  onChange={(e) => setStage(index, { mode: e.target.value as 'ANY' | 'ALL' })}
                >
                  <option value="ANY">Any one approver</option>
                  <option value="ALL">Every approver</option>
                </Select>
              </Field>
              {policy.hasAmount && (
                <Field id={`stage-${index}-min`} label="Only from amount" hint="Leave empty to always apply">
                  <Input
                    id={`stage-${index}-min`}
                    inputMode="decimal"
                    value={stage.minAmount ?? ''}
                    onChange={(e) => {
                      const { minAmount: _drop, ...rest } = stage;
                      setDefinition((d) => ({
                        ...d,
                        stages: d.stages.map((s, i) =>
                          i === index ? (e.target.value ? { ...rest, minAmount: e.target.value } : rest) : s,
                        ),
                      }));
                    }}
                  />
                </Field>
              )}
              <Field id={`stage-${index}-due`} label="Remind after (hours)" hint="Optional">
                <Input
                  id={`stage-${index}-due`}
                  inputMode="numeric"
                  value={stage.dueInHours ?? ''}
                  onChange={(e) => {
                    const { dueInHours: _drop, ...rest } = stage;
                    const hours = Number.parseInt(e.target.value, 10);
                    setDefinition((d) => ({
                      ...d,
                      stages: d.stages.map((s, i) =>
                        i === index ? (Number.isFinite(hours) ? { ...rest, dueInHours: hours } : rest) : s,
                      ),
                    }));
                  }}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium">Approvers</span>
              {stage.approvers.map((rule, ruleIndex) => (
                <RuleRow
                  key={ruleIndex}
                  id={`stage-${index}-rule-${ruleIndex}`}
                  rule={rule}
                  canPickRoles={canPickRoles}
                  roles={roles.data?.map((r) => ({ id: r.id, name: r.name })) ?? []}
                  permissions={
                    permissions.data?.map((p) => ({ code: p.code, label: `${p.moduleLabel}: ${p.label}` })) ??
                    []
                  }
                  colleagues={colleagues.data ?? []}
                  onChange={(next) =>
                    setStage(index, {
                      approvers: stage.approvers.map((r, i) => (i === ruleIndex ? next : r)),
                    })
                  }
                  {...(stage.approvers.length > 1
                    ? {
                        onRemove: () =>
                          setStage(index, { approvers: stage.approvers.filter((_, i) => i !== ruleIndex) }),
                      }
                    : {})}
                />
              ))}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStage(index, { approvers: [...stage.approvers, { type: 'OWNERS' }] })}
                >
                  <Plus aria-hidden="true" className="size-4" /> Add approver
                </Button>
              </div>
            </div>

            {definition.stages.length > 1 && (
              <div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    setDefinition((d) => ({ ...d, stages: d.stages.filter((_, i) => i !== index) }))
                  }
                >
                  Remove stage {index + 1}
                </Button>
              </div>
            )}
            {stage.minAmount && policy.hasAmount && decimalString.safeParse(stage.minAmount).success && (
              <p className="text-xs text-muted-foreground">
                Applies to requests of {formatAmount(stage.minAmount, null)} or more.
              </p>
            )}
          </fieldset>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDefinition((d) => ({
                ...d,
                stages: [...d.stages, { ...DEFAULT_STAGE, name: `Stage ${d.stages.length + 1}` }],
              }))
            }
          >
            <Plus aria-hidden="true" className="size-4" /> Add stage
          </Button>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={definition.distinctApprovers}
              onChange={(e) => setDefinition((d) => ({ ...d, distinctApprovers: e.target.checked }))}
            />
            One person can approve only one stage
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Nobody ever approves their own request. If a stage finds no approver, organisation owners are asked
          instead.
        </p>
      </div>
    </Dialog>
  );
}

function RuleRow({
  id,
  rule,
  canPickRoles,
  roles,
  permissions,
  colleagues,
  onChange,
  onRemove,
}: {
  id: string;
  rule: ApproverRule;
  canPickRoles: boolean;
  roles: { id: string; name: string }[];
  permissions: { code: string; label: string }[];
  colleagues: Colleague[];
  onChange: (rule: ApproverRule) => void;
  onRemove?: () => void;
}) {
  function changeType(type: ApproverRule['type']) {
    if (type === 'OWNERS') onChange({ type });
    // Start unselected: the lists may still be loading, and a silent default is easy to miss.
    if (type === 'ROLE') onChange({ type, roleId: '' });
    if (type === 'PERMISSION') onChange({ type, permission: '' });
    if (type === 'MEMBER') onChange({ type, membershipId: '' });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`${id}-type`} className="sr-only">
        Approver type
      </label>
      <Select
        id={`${id}-type`}
        className="w-auto min-w-[170px]"
        value={rule.type}
        onChange={(e) => changeType(e.target.value as ApproverRule['type'])}
      >
        <option value="OWNERS">Organisation owners</option>
        <option value="MEMBER">A named person</option>
        {canPickRoles && <option value="ROLE">Anyone with a role</option>}
        {canPickRoles && <option value="PERMISSION">Anyone with a permission</option>}
      </Select>
      {rule.type === 'ROLE' && (
        <>
          <label htmlFor={`${id}-role`} className="sr-only">
            Role
          </label>
          <Select
            id={`${id}-role`}
            className="w-auto min-w-[180px] flex-1"
            value={rule.roleId}
            onChange={(e) => onChange({ type: 'ROLE', roleId: e.target.value })}
          >
            <option value="">Choose a role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </>
      )}
      {rule.type === 'PERMISSION' && (
        <>
          <label htmlFor={`${id}-permission`} className="sr-only">
            Permission
          </label>
          <Select
            id={`${id}-permission`}
            className="w-auto min-w-[180px] flex-1"
            value={rule.permission}
            onChange={(e) => onChange({ type: 'PERMISSION', permission: e.target.value })}
          >
            <option value="">Choose a permission</option>
            {permissions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </Select>
        </>
      )}
      {rule.type === 'MEMBER' && (
        <>
          <label htmlFor={`${id}-member`} className="sr-only">
            Person
          </label>
          <Select
            id={`${id}-member`}
            className="w-auto min-w-[180px] flex-1"
            value={rule.membershipId}
            onChange={(e) => onChange({ type: 'MEMBER', membershipId: e.target.value })}
          >
            <option value="">Choose a person</option>
            {colleagues.map((c) => (
              <option key={c.membershipId} value={c.membershipId}>
                {c.displayName}
              </option>
            ))}
          </Select>
        </>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove approver"
          className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
