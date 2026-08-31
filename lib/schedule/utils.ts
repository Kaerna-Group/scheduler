import type { Lesson, WeekDay } from '@/lib/schedule/types';

export const dayOrder: WeekDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const dayLabels: Record<WeekDay, string> = {
  monday: 'Понеділок', tuesday: 'Вівторок', wednesday: 'Середа',
  thursday: 'Четвер', friday: "П'ятниця", saturday: 'Субота',
};

export const dayLabelsShort: Record<WeekDay, string> = {
  monday: 'Пн', tuesday: 'Вт', wednesday: 'Ср', thursday: 'Чт', friday: 'Пт', saturday: 'Сб',
};

export function getLessonsForDay(source: Lesson[], week: number, day: WeekDay, subjectId = 'all') {
  return source
    .filter((lesson) => lesson.day === day && lesson.weeks.includes(week) && (subjectId === 'all' || lesson.subjectId === subjectId))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function lessonsOverlap(a: Lesson, b: Lesson, week: number) {
  if (a.day !== b.day || !a.weeks.includes(week) || !b.weeks.includes(week)) return false;
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(b.startTime) < timeToMinutes(a.endTime);
}

export function getConflictIds(source: Lesson[], week: number) {
  const active = source.filter((lesson) => lesson.weeks.includes(week));
  const result = new Set<string>();
  active.forEach((lesson, index) => {
    active.slice(index + 1).forEach((candidate) => {
      if (lessonsOverlap(lesson, candidate, week)) {
        result.add(lesson.id);
        result.add(candidate.id);
      }
    });
  });
  return result;
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function getSemesterWeek(startDate: string, weeksCount: number) {
  const start = parseLocalDate(startDate);
  const startDay = start.getDay() || 7;
  start.setDate(start.getDate() - startDay + 1);
  start.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = Math.floor((today.getTime() - start.getTime()) / 604_800_000) + 1;
  return Math.min(Math.max(week, 1), weeksCount);
}

export function getCurrentWeekDay(): WeekDay | null {
  const index = new Date().getDay() - 1;
  return dayOrder[index] ?? null;
}

export function getWeekDates(startDate: string, week: number) {
  const start = parseLocalDate(startDate);
  const startDay = start.getDay() || 7;
  start.setDate(start.getDate() - startDay + 1 + (week - 1) * 7);
  return dayOrder.reduce((acc, day, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    acc[day] = date;
    return acc;
  }, {} as Record<WeekDay, Date>);
}
