import type { ImportPlanChange, ImportPlanResponse, ImportSharedConflict } from '@/lib/schedule/types';

export interface ImportDiff {
  newSubjects: ImportPlanChange[];
  newLessons: ImportPlanChange[];
  changedLessons: ImportPlanChange[];
  removedEnrollments: ImportPlanChange[];
  otherChanges: ImportPlanChange[];
  conflictsBySubject: Array<{ externalCode: string; conflicts: ImportSharedConflict[] }>;
}

export function buildImportDiff(response: ImportPlanResponse): ImportDiff {
  const newSubjects: ImportPlanChange[] = [];
  const newLessons: ImportPlanChange[] = [];
  const changedLessons: ImportPlanChange[] = [];
  const removedEnrollments: ImportPlanChange[] = [];
  const otherChanges: ImportPlanChange[] = [];

  response.plan.forEach((change) => {
    if (change.entityType === 'Subject' && change.action === 'CREATE') newSubjects.push(change);
    else if (change.entityType === 'Lesson' && change.action === 'CREATE') newLessons.push(change);
    else if (change.entityType === 'Lesson' && !change.partOfReplacement) changedLessons.push(change);
    else if (change.entityType === 'Enrollment' && change.action === 'UNENROLL') removedEnrollments.push(change);
    else otherChanges.push(change);
  });

  const grouped = new Map<string, ImportSharedConflict[]>();
  (response.conflicts ?? []).forEach((conflict) => {
    const current = grouped.get(conflict.externalCode) ?? [];
    current.push(conflict);
    grouped.set(conflict.externalCode, current);
  });

  return {
    newSubjects,
    newLessons,
    changedLessons,
    removedEnrollments,
    otherChanges,
    conflictsBySubject: [...grouped].map(([externalCode, conflicts]) => ({ externalCode, conflicts })),
  };
}
