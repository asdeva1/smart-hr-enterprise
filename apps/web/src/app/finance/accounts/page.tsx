'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
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
import { errorMessage } from '@/lib/admin';
import { apiFetch } from '@/lib/api';
import {
  ACCOUNT_TYPE_LABEL,
  financeKeys,
  useAccounts,
  useBooksCompany,
  type AccountType,
  type LedgerAccount,
} from '@/lib/finance';
import { can } from '@/lib/permissions';
import { CompanyPicker, FinancePage, FinanceTabs } from '../finance-page';

export default function AccountsPage() {
  return (
    <FinancePage>
      {(session) => <Accounts session={session} configure={can(session, 'finance.configure')} />}
    </FinancePage>
  );
}

function Accounts({
  session,
  configure,
}: {
  session: Parameters<typeof FinanceTabs>[0]['session'];
  configure: boolean;
}) {
  const [companyId, setCompanyId] = useBooksCompany();
  const accounts = useAccounts(companyId);
  const [editing, setEditing] = useState<LedgerAccount | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="Accounts marked “system” are used by payroll postings; they can be renamed but not archived."
        actions={
          configure && companyId ? <Button onClick={() => setEditing('new')}>Add account</Button> : null
        }
      />
      <FinanceTabs session={session} active="/finance/accounts" />
      <CompanyPicker value={companyId} onChange={setCompanyId} />
      {!companyId || accounts.isPending ? (
        <Loading />
      ) : accounts.isError ? (
        <Alert tone="error">{errorMessage(accounts.error)}</Alert>
      ) : (
        <Table label="Accounts">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th className="sr-only">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.map((a) => (
              <tr key={a.id}>
                <Td className="tabular-nums">{a.code}</Td>
                <Td>
                  <Link
                    href={`/finance/accounts/${a.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {a.name}
                  </Link>
                  {a.systemKey && (
                    <span className="ml-2">
                      <Badge>System</Badge>
                    </span>
                  )}
                </Td>
                <Td>{ACCOUNT_TYPE_LABEL[a.type]}</Td>
                <Td>{a.status === 'ACTIVE' ? 'Active' : 'Archived'}</Td>
                <Td className="text-right">
                  {configure && (
                    <Button variant="outline" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>
                      Edit
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && (
        <AccountDialog
          companyId={companyId}
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function AccountDialog({
  companyId,
  account,
  onClose,
}: {
  companyId: string;
  account: LedgerAccount | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'EXPENSE');
  const [description, setDescription] = useState(account?.description ?? '');
  const [status, setStatus] = useState(account?.status ?? 'ACTIVE');
  const save = useMutation({
    mutationFn: () =>
      account
        ? apiFetch(`/v1/finance/accounts/${account.id}`, {
            method: 'PATCH',
            body: { code, name, description, status },
          })
        : apiFetch('/v1/finance/accounts', {
            method: 'POST',
            body: { companyId, code, name, type, description },
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: financeKeys.accounts(companyId) });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? 'Edit account' : 'Add account'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <Field id="account-code" label="Code">
          <Input id="account-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field id="account-name" label="Name">
          <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          id="account-type"
          label="Type"
          hint={account ? 'An account’s type can’t change once created.' : undefined}
        >
          <Select
            id="account-type"
            value={type}
            disabled={!!account}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="account-description" label="Description (optional)">
          <Input
            id="account-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        {account && !account.systemKey && (
          <Field id="account-status" label="Status">
            <Select
              id="account-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'ARCHIVED')}
            >
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
