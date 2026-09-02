import { lessons } from '@/data/lessons';
import { semester } from '@/data/semester';
import { subjects } from '@/data/subjects';
import { users } from '@/data/users';
import type { UserSchedule } from '@/lib/schedule/types';

export const fallbackSchedule: UserSchedule = {
  users,
  user: users[0],
  semester,
  semesters: [{ ...semester, archived: false, current: true }],
  currentSemesterId: semester.id,
  subjects,
  lessons,
  revision: 0,
};
