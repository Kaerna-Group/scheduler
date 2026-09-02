import { postApi } from '@/lib/api/client';
import type { SemesterSummary } from '@/lib/schedule/types';

export interface SemesterMutationResponse {
  revision: number;
  semesters: SemesterSummary[];
  semester?: SemesterSummary;
  copiedSubjects?: number;
}

export function createSemester(args: {
  token: string;
  baseRevision: number;
  semester: { id: string; title: string; startDate: string; weeksCount: number };
  sourceSemesterId?: string;
  copySubjects: boolean;
  makeCurrent: boolean;
  signal?: AbortSignal;
}) {
  return postApi<SemesterMutationResponse>({
    action: 'createSemester',
    editToken: args.token,
    baseRevision: args.baseRevision,
    semester: args.semester,
    sourceSemesterId: args.sourceSemesterId ?? '',
    copySubjects: args.copySubjects,
    makeCurrent: args.makeCurrent,
  }, args.signal);
}

export function setCurrentSemester(args: { token: string; baseRevision: number; semesterId: string; signal?: AbortSignal }) {
  return postApi<SemesterMutationResponse>({ action: 'setCurrentSemester', editToken: args.token, baseRevision: args.baseRevision, semesterId: args.semesterId }, args.signal);
}

export function archiveSemester(args: { token: string; baseRevision: number; semesterId: string; signal?: AbortSignal }) {
  return postApi<SemesterMutationResponse>({ action: 'archiveSemester', editToken: args.token, baseRevision: args.baseRevision, semesterId: args.semesterId }, args.signal);
}
