import type { TenantTransaction } from '@smart-hr/database';
import { LEGACY_OVERTIME, type OvertimePolicy } from './attendance-calc.js';

export interface AttendancePolicyView {
  /** False when the organisation has never saved rules: the legacy behaviour applies. */
  configured: boolean;
  overtime: OvertimePolicy;
  overtimeNeedsApproval: boolean;
  maxCorrectionsPerMonth: number | null;
  maxCorrectionBackdateDays: number | null;
  geofenceMode: 'OFF' | 'WARN' | 'ENFORCE';
}

export const DEFAULT_POLICY: AttendancePolicyView = {
  configured: false,
  overtime: LEGACY_OVERTIME,
  overtimeNeedsApproval: false,
  maxCorrectionsPerMonth: null,
  maxCorrectionBackdateDays: null,
  geofenceMode: 'OFF',
};

/** The organisation's attendance rules (row-level security scopes this to the current organisation). */
export async function loadPolicy(tx: TenantTransaction): Promise<AttendancePolicyView> {
  const row = await tx.attendancePolicy.findFirst();
  if (!row) return DEFAULT_POLICY;
  return {
    configured: true,
    overtime: {
      enabled: row.overtimeEnabled,
      thresholdMinutes: row.overtimeThresholdMinutes,
      roundMinutes: row.overtimeRoundMinutes,
      dailyCapMinutes: row.overtimeDailyCapMinutes,
      offDayCounts: row.overtimeOffDayCounts,
    },
    overtimeNeedsApproval: row.overtimeNeedsApproval,
    maxCorrectionsPerMonth: row.maxCorrectionsPerMonth,
    maxCorrectionBackdateDays: row.maxCorrectionBackdateDays,
    geofenceMode: row.geofenceMode,
  };
}
