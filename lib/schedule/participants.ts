import type { Lesson, ScheduleUser, UserSchedule } from '@/lib/schedule/types';

export type ParticipantCheckState =
  | 'checking'
  | 'complete'
  | 'stale'
  | 'unavailable';
export interface LessonParticipants {
  users: ScheduleUser[];
  state: ParticipantCheckState;
  checked: number;
  total: number;
}
export type ParticipantsForLesson = (
  lesson: Lesson,
  week: number,
) => LessonParticipants;

export function getLessonParticipants(
  schedule: UserSchedule,
  lesson: Lesson,
  week: number,
): ScheduleUser[] {
  const ids = schedule.lessonParticipants?.find(
    (entry) => entry.lessonId === lesson.id && entry.week === week,
  )?.userIds;
  if (!ids) return [];
  const users = new Map(schedule.users.map((user) => [user.id, user]));
  return ids.flatMap((id) => (users.has(id) ? [users.get(id)!] : []));
}
