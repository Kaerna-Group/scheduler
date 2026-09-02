import type { ScheduleUser } from '@/lib/schedule/types';

export interface HistoryActor {
  id: string;
  slug: string;
  displayName: string;
}

export interface HistorySubject {
  id: string;
  offeringId: string;
  externalCode: string;
  name: string;
  shortName: string;
  color: string;
}

export interface ScheduleHistoryEvent {
  id: string;
  timestamp: string;
  revision: number;
  action: string;
  entityType: 'Lesson' | 'Subject' | 'Offering' | 'Group' | 'Enrollment' | 'Import';
  entityId: string;
  scope: 'shared' | 'personal';
  actor: HistoryActor;
  subject: HistorySubject | null;
  oldValue: unknown;
  newValue: unknown;
}

export interface ScheduleHistoryResponse {
  user: ScheduleUser;
  semesterId: string;
  revision: number;
  events: ScheduleHistoryEvent[];
  undo?: {
    available: boolean;
    reason: string;
    importRevision: number | null;
    timestamp: string | null;
    targetUserSlug: string | null;
    actorDisplayName: string | null;
  };
}
