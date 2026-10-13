import { Injectable } from '@nestjs/common';
import type { ApprovalRequest, TenantTransaction } from '@smart-hr/database';

/**
 * What a module does when its request is decided. Hooks run inside the same transaction as the decision,
 * so the subject (e.g. a leave request) and its approval always agree.
 */
export interface ApprovalSubjectHandler {
  onApproved?(tx: TenantTransaction, request: ApprovalRequest): Promise<void>;
  onRejected?(tx: TenantTransaction, request: ApprovalRequest, comment: string | null): Promise<void>;
  onReturned?(tx: TenantTransaction, request: ApprovalRequest, comment: string | null): Promise<void>;
  onCancelled?(tx: TenantTransaction, request: ApprovalRequest): Promise<void>;
  /** Web link to the subject, shown in the approval and its notifications. */
  link?(request: ApprovalRequest): string;
}

/** Modules register their handler at start-up; the engine calls it when a request of that type is decided. */
@Injectable()
export class ApprovalSubjectRegistry {
  private readonly handlers = new Map<string, ApprovalSubjectHandler>();

  register(subjectType: string, handler: ApprovalSubjectHandler): void {
    this.handlers.set(subjectType, handler);
  }

  get(subjectType: string): ApprovalSubjectHandler {
    return this.handlers.get(subjectType) ?? {};
  }
}
