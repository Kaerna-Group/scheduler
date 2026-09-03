import { getApi } from '@/lib/api/client';
import type {
  Lesson,
  ScheduleUser,
  Subject,
  UserSchedule,
} from '@/lib/schedule/types';

export type ParticipantSchedule = Pick<
  UserSchedule,
  'user' | 'semester' | 'revision' | 'subjects' | 'lessons'
>;
export interface LessonParticipants {
  users: ScheduleUser[];
  incomplete: boolean;
  cached: boolean;
}
export type ParticipantsForLesson = (
  lesson: Lesson,
  week: number,
) => LessonParticipants;

export async function fetchParticipantSchedule(
  user: ScheduleUser,
  semester: string,
  signal: AbortSignal,
): Promise<ParticipantSchedule> {
  const schedule = await getApi<UserSchedule>(
    { action: 'schedule', user: user.slug, semester },
    signal,
  );
  signal.throwIfAborted();
  if (
    schedule.user.id !== user.id ||
    schedule.user.slug !== user.slug ||
    schedule.semester.id !== semester
  )
    throw new Error(
      'A participant schedule does not match the requested user or semester.',
    );
  // Reading classmates must not change another user's sync baseline or preferences.
  return {
    user: schedule.user,
    semester: schedule.semester,
    revision: schedule.revision,
    subjects: schedule.subjects,
    lessons: schedule.lessons,
  };
}

function personalLesson(lesson: Lesson, subject: Subject) {
  return (
    lesson.type === 'lecture' ||
    subject.selectedGroup === undefined ||
    lesson.group === subject.selectedGroup
  );
}

function sameCourse(subject: Subject, candidate: Subject) {
  if (subject.offeringId && candidate.offeringId)
    return subject.offeringId === candidate.offeringId;
  if (subject.externalCode && candidate.externalCode)
    return subject.externalCode === candidate.externalCode;
  return subject.id === candidate.id;
}

export function getLessonParticipants(
  owner: ParticipantSchedule,
  peers: ParticipantSchedule[],
  lesson: Lesson,
  week: number,
): ScheduleUser[] {
  const subject = owner.subjects.find((item) => item.id === lesson.subjectId);
  if (
    !subject ||
    !personalLesson(lesson, subject) ||
    !lesson.weeks.includes(week)
  )
    return [];
  const participants = new Map<string, ScheduleUser>([
    [owner.user.id, owner.user],
  ]);
  for (const peer of peers) {
    if (
      peer.semester.id !== owner.semester.id ||
      peer.semester.startDate !== owner.semester.startDate ||
      peer.semester.weeksCount !== owner.semester.weeksCount
    )
      continue;
    const matchingSubjects = peer.subjects.filter((item) =>
      sameCourse(subject, item),
    );
    if (
      peer.lessons.some((candidate) => {
        const candidateSubject = matchingSubjects.find(
          (item) => item.id === candidate.subjectId,
        );
        return (
          candidateSubject &&
          personalLesson(candidate, candidateSubject) &&
          candidate.type === lesson.type &&
          (lesson.type !== 'group' || candidate.group === lesson.group) &&
          candidate.day === lesson.day &&
          candidate.startTime === lesson.startTime &&
          candidate.endTime === lesson.endTime &&
          candidate.weeks.includes(week)
        );
      })
    )
      participants.set(peer.user.id, peer.user);
  }
  return [
    owner.user,
    ...[...participants.values()]
      .filter((user) => user.id !== owner.user.id)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  ];
}
