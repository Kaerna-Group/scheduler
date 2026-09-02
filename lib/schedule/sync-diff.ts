import type { Lesson, Subject, UserSchedule } from '@/lib/schedule/types';
import { dayLabels, dayOrder } from '@/lib/schedule/utils';
import { formatWeeks } from '@/lib/schedule/weeks';

export interface SyncFieldChange {
  label: string;
  before: string;
  after: string;
}
export interface SyncItemChange {
  id: string;
  kind: 'added' | 'updated' | 'removed';
  title: string;
  context: string;
  fields: SyncFieldChange[];
}
export interface ScheduleSyncDiff {
  userId: string;
  userSlug: string;
  userName: string;
  semesterId: string;
  semesterTitle: string;
  fromRevision: number;
  toRevision: number;
  previousSync: string;
  syncedAt: string;
  lessons: SyncItemChange[];
  subjects: SyncItemChange[];
  semester: SyncFieldChange[];
}

const display = (value: string | number | undefined) =>
  value === undefined || value === '' ? 'Not set' : String(value);
const lessonType = (lesson: Lesson) =>
  lesson.type === 'lecture' ? 'Lecture' : `Group ${lesson.group ?? '—'}`;
const format = { online: 'Online', offline: 'On campus', hybrid: 'Hybrid' };
const subjectName = (subject: Subject) => subject.name;
const courseReference = (subject: Subject) =>
  `${subject.name} (${subject.externalCode || subject.id})`;

function fields(
  before: Record<string, string>,
  after: Record<string, string>,
): SyncFieldChange[] {
  return Object.keys(before)
    .filter((key) => before[key] !== after[key])
    .map((label) => ({ label, before: before[label], after: after[label] }));
}

function lessonFields(lesson: Lesson, subjects: Map<string, Subject>) {
  return {
    Course: courseReference(subjects.get(lesson.subjectId)!),
    Day: dayLabels[lesson.day],
    Start: lesson.startTime,
    End: lesson.endTime,
    Weeks: formatWeeks(lesson.weeks),
    Type: lesson.type === 'lecture' ? 'Lecture' : 'Group class',
    Group: display(lesson.group),
    Room: display(lesson.room),
    Format: format[lesson.format],
    Teacher: display(lesson.teacher),
  };
}
function subjectFields(subject: Subject) {
  return {
    Name: subject.name,
    'Short name': subject.shortName,
    'Course code': display(subject.externalCode),
    'Selected group': display(subject.selectedGroup),
  };
}
function semesterFields(schedule: UserSchedule) {
  return {
    Title: schedule.semester.title,
    'Start date': schedule.semester.startDate,
    'Week count': String(schedule.semester.weeksCount),
  };
}

// Caches from older installations are untrusted. A broken snapshot must not
// turn a successful refresh into an error or a misleading mass-removal notice.
function comparable(schedule: UserSchedule) {
  if (
    !schedule?.user?.id ||
    !schedule.user.slug ||
    !schedule.semester?.id ||
    !Number.isInteger(schedule.revision) ||
    schedule.revision < 0 ||
    typeof schedule.semester.title !== 'string' ||
    typeof schedule.semester.startDate !== 'string' ||
    !Number.isInteger(schedule.semester.weeksCount) ||
    !Array.isArray(schedule.subjects) ||
    !Array.isArray(schedule.lessons)
  )
    return false;
  const subjectIds = new Set<string>();
  for (const subject of schedule.subjects) {
    if (
      !subject?.id ||
      subjectIds.has(subject.id) ||
      typeof subject.name !== 'string' ||
      typeof subject.shortName !== 'string'
    )
      return false;
    subjectIds.add(subject.id);
  }
  const lessonIds = new Set<string>();
  for (const lesson of schedule.lessons) {
    if (
      !lesson?.id ||
      lessonIds.has(lesson.id) ||
      !subjectIds.has(lesson.subjectId) ||
      !dayOrder.includes(lesson.day) ||
      !['lecture', 'group'].includes(lesson.type) ||
      !Object.hasOwn(format, lesson.format) ||
      typeof lesson.startTime !== 'string' ||
      typeof lesson.endTime !== 'string' ||
      typeof lesson.teacher !== 'string' ||
      !Array.isArray(lesson.weeks) ||
      !lesson.weeks.length ||
      lesson.weeks.some(
        (week) =>
          !Number.isInteger(week) ||
          week < 1 ||
          week > schedule.semester.weeksCount,
      )
    )
      return false;
    lessonIds.add(lesson.id);
  }
  return true;
}

export function compareScheduleSync(
  before: UserSchedule | null,
  after: UserSchedule,
  previousSync: string,
  syncedAt: string,
): ScheduleSyncDiff | null {
  try {
    if (
      !before ||
      !comparable(before) ||
      !comparable(after) ||
      before.user.id !== after.user.id ||
      before.user.slug !== after.user.slug ||
      before.semester.id !== after.semester.id
    )
      return null;
    const oldSubjects = new Map(before.subjects.map((item) => [item.id, item]));
    const newSubjects = new Map(after.subjects.map((item) => [item.id, item]));
    const oldLessons = new Map(before.lessons.map((item) => [item.id, item]));
    const newLessons = new Map(after.lessons.map((item) => [item.id, item]));
    const lessons: SyncItemChange[] = [];
    for (const id of new Set([...oldLessons.keys(), ...newLessons.keys()])) {
      const oldLesson = oldLessons.get(id);
      const newLesson = newLessons.get(id);
      const lesson = (newLesson ?? oldLesson)!;
      const subjects = newLesson ? newSubjects : oldSubjects;
      const changes =
        oldLesson && newLesson
          ? fields(
              lessonFields(oldLesson, oldSubjects),
              lessonFields(newLesson, newSubjects),
            )
          : [];
      // Course metadata is listed once below, not once per affected lesson.
      const changed =
        oldLesson?.subjectId === newLesson?.subjectId
          ? changes.filter((change) => change.label !== 'Course')
          : changes;
      if (!oldLesson || !newLesson || changed.length)
        lessons.push({
          id,
          kind: !oldLesson ? 'added' : !newLesson ? 'removed' : 'updated',
          title: subjectName(subjects.get(lesson.subjectId)!),
          context: `${lessonType(lesson)} · ${dayLabels[lesson.day]} ${lesson.startTime}–${lesson.endTime} · Weeks ${formatWeeks(lesson.weeks)}${lesson.room ? ` · ${lesson.room}` : ''} · ${format[lesson.format]} · ${lesson.teacher}`,
          fields: changed,
        });
    }
    const subjects: SyncItemChange[] = [];
    for (const id of new Set([...oldSubjects.keys(), ...newSubjects.keys()])) {
      const oldSubject = oldSubjects.get(id);
      const newSubject = newSubjects.get(id);
      const subject = (newSubject ?? oldSubject)!;
      const changed =
        oldSubject && newSubject
          ? fields(subjectFields(oldSubject), subjectFields(newSubject))
          : [];
      if (!oldSubject || !newSubject || changed.length)
        subjects.push({
          id,
          kind: !oldSubject ? 'added' : !newSubject ? 'removed' : 'updated',
          title: subjectName(subject),
          context: `${subject.externalCode || subject.id}${subject.selectedGroup === undefined ? '' : ` · Group ${subject.selectedGroup}`}`,
          fields: changed,
        });
    }
    const semester = fields(semesterFields(before), semesterFields(after));
    if (!lessons.length && !subjects.length && !semester.length) return null;
    const sort = (a: SyncItemChange, b: SyncItemChange) =>
      a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    return {
      userId: after.user.id,
      userSlug: after.user.slug,
      userName: after.user.displayName,
      semesterId: after.semester.id,
      semesterTitle: after.semester.title,
      fromRevision: before.revision,
      toRevision: after.revision,
      previousSync,
      syncedAt,
      lessons: lessons.sort(sort),
      subjects: subjects.sort(sort),
      semester,
    };
  } catch {
    return null;
  }
}

export function syncDiffSummary(diff: ScheduleSyncDiff) {
  const parts: string[] = [];
  if (diff.lessons.length)
    parts.push(
      `${diff.lessons.length} ${diff.lessons.length === 1 ? 'class' : 'classes'} changed`,
    );
  if (diff.subjects.length)
    parts.push(
      `${diff.subjects.length} ${diff.subjects.length === 1 ? 'course' : 'courses'} changed`,
    );
  if (diff.semester.length) parts.push('Semester changed');
  return parts.join(' · ');
}
