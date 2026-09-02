import type { SchedulerPreferences } from '@/lib/preferences/types';
import type {
  ScheduleUser,
  SemesterSummary,
  UserRole,
} from '@/lib/schedule/types';

export interface AdminUser extends ScheduleUser {
  active: boolean;
  enrollmentCount: number;
  preferencesRevision: number | null;
}

export interface AdminAuditEntry {
  id: string;
  timestamp: string;
  revision: number;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface AdminAuditFilters {
  actorId?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

export interface AdminAuditResponse {
  revision: number;
  total: number;
  offset: number;
  limit: number;
  entries: AdminAuditEntry[];
}

export interface AdminOverview {
  actor: ScheduleUser;
  revision: number;
  schema: { current: string | null; expected: string };
  semester: SemesterSummary | null;
  semesters: SemesterSummary[];
  statistics: {
    usersTotal: number;
    usersActive: number;
    subjects: number;
    offerings: number;
    groups: number;
    lessons: number;
    enrollments: number;
    auditEntries: number;
  };
  tables: Array<{ name: string; rows: number }>;
  diagnostics: Array<{
    code: string;
    level: 'ok' | 'warning' | 'error';
    message: string;
  }>;
  users: AdminUser[];
  recentAudit: AdminAuditEntry[];
  auditOptions: { actions: string[]; entityTypes: string[] };
}

export interface AdminUserDetails {
  revision: number;
  user: AdminUser;
  semester: SemesterSummary;
  catalog: Array<{
    offeringId: string;
    externalCode: string;
    subject: { id: string; name: string; shortName: string; color: string };
    availableGroups: number[];
  }>;
  enrollments: Array<{
    offeringId: string;
    externalCode: string;
    selectedGroup: number | null;
  }>;
  preferences: SchedulerPreferences | null;
  recentAudit: AdminAuditEntry[];
}

export interface AdminMutationResponse {
  revision: number;
  user: AdminUser;
  editToken?: string;
}

export type AdminUserPatch = {
  displayName?: string;
  role?: UserRole;
  active?: boolean;
};
