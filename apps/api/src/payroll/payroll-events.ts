import { Injectable } from '@nestjs/common';
import type { PayrollRun, TenantTransaction } from '@smart-hr/database';

type Listener = (tx: TenantTransaction, run: PayrollRun, actorUserId: string | null) => Promise<void>;

/**
 * Lets other modules act when payroll is approved or paid, inside the same transaction, without payroll
 * depending on them. Finance registers here to post the payroll journals.
 */
@Injectable()
export class PayrollEvents {
  private readonly approved: Listener[] = [];
  private readonly paid: Listener[] = [];

  onApproved(listener: Listener) {
    this.approved.push(listener);
  }

  onPaid(listener: Listener) {
    this.paid.push(listener);
  }

  async emitApproved(tx: TenantTransaction, run: PayrollRun, actorUserId: string | null) {
    for (const l of this.approved) await l(tx, run, actorUserId);
  }

  async emitPaid(tx: TenantTransaction, run: PayrollRun, actorUserId: string | null) {
    for (const l of this.paid) await l(tx, run, actorUserId);
  }
}
