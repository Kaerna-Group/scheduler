import type {
  ImportLesson,
  ImportSubject,
  LessonFormat,
  LessonType,
  ScheduleImportV1,
  UserSchedule,
  WeekDay,
} from '@/lib/schedule/types';
import { isSubjectColor, subjectColorAt } from '@/lib/schedule/subject-palette';

const days = new Set<WeekDay>(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const types = new Set<LessonType>(['lecture', 'group']);
const formats = new Set<LessonFormat>(['offline', 'online', 'hybrid']);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ImportValidationResult {
  value?: ScheduleImportV1;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateScheduleImport(input: unknown, weeksCount = 14): ImportValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { errors: ['Кореневе значення має бути JSON-об’єктом.'] };
  if (input.schemaVersion !== 1) errors.push('schemaVersion має дорівнювати 1.');
  if (typeof input.semesterId !== 'string' || !input.semesterId.trim()) errors.push('semesterId є обов’язковим.');
  if (!Array.isArray(input.subjects)) errors.push('subjects має бути масивом.');

  const subjects: ImportSubject[] = [];
  const codes = new Set<string>();

  if (Array.isArray(input.subjects)) {
    input.subjects.forEach((rawSubject, subjectIndex) => {
      const prefix = `subjects[${subjectIndex}]`;
      if (!isRecord(rawSubject)) {
        errors.push(`${prefix} має бути об’єктом.`);
        return;
      }

      const externalCode = typeof rawSubject.externalCode === 'string' ? rawSubject.externalCode.trim() : '';
      const name = typeof rawSubject.name === 'string' ? rawSubject.name.trim() : '';
      if (!externalCode) errors.push(`${prefix}.externalCode є обов’язковим.`);
      if (!name) errors.push(`${prefix}.name є обов’язковим.`);
      if (externalCode && codes.has(externalCode)) errors.push(`${prefix}.externalCode дублюється: ${externalCode}.`);
      codes.add(externalCode);

      const selectedGroup = rawSubject.selectedGroup === undefined ? undefined : Number(rawSubject.selectedGroup);
      if (selectedGroup !== undefined && (!Number.isInteger(selectedGroup) || selectedGroup < 1)) {
        errors.push(`${prefix}.selectedGroup має бути додатним цілим числом.`);
      }
      if (rawSubject.color !== undefined && !isSubjectColor(rawSubject.color)) {
        errors.push(`${prefix}.color має бути у форматі #RRGGBB.`);
      }

      const normalizedLessons: ImportLesson[] = [];
      if (rawSubject.lessons !== undefined && !Array.isArray(rawSubject.lessons)) {
        errors.push(`${prefix}.lessons має бути масивом.`);
      }

      if (Array.isArray(rawSubject.lessons)) {
        rawSubject.lessons.forEach((rawLesson, lessonIndex) => {
          const lessonPrefix = `${prefix}.lessons[${lessonIndex}]`;
          if (!isRecord(rawLesson)) {
            errors.push(`${lessonPrefix} має бути об’єктом.`);
            return;
          }

          const type = rawLesson.type as LessonType;
          const day = rawLesson.day as WeekDay;
          const format = rawLesson.format as LessonFormat;
          const startTime = typeof rawLesson.startTime === 'string' ? rawLesson.startTime : '';
          const endTime = typeof rawLesson.endTime === 'string' ? rawLesson.endTime : '';
          const teacher = typeof rawLesson.teacher === 'string' ? rawLesson.teacher.trim() : '';
          const group = rawLesson.group === undefined ? undefined : Number(rawLesson.group);

          if (!types.has(type)) errors.push(`${lessonPrefix}.type має бути lecture або group.`);
          if (!days.has(day)) errors.push(`${lessonPrefix}.day має неприпустиме значення.`);
          if (!formats.has(format)) errors.push(`${lessonPrefix}.format має неприпустиме значення.`);
          if (!timePattern.test(startTime) || !timePattern.test(endTime) || startTime >= endTime) {
            errors.push(`${lessonPrefix}: час має бути у форматі HH:MM, а початок — раніше завершення.`);
          }
          if (!teacher) errors.push(`${lessonPrefix}.teacher є обов’язковим.`);
          if (type === 'group' && (!Number.isInteger(group) || Number(group) < 1)) {
            errors.push(`${lessonPrefix}.group є обов’язковим для групового заняття.`);
          }
          if (!Array.isArray(rawLesson.weeks) || rawLesson.weeks.length === 0) {
            errors.push(`${lessonPrefix}.weeks має містити хоча б один тиждень.`);
          }

          const weeks = Array.isArray(rawLesson.weeks)
            ? [...new Set(rawLesson.weeks.map(Number))].sort((a, b) => a - b)
            : [];
          if (weeks.some((week) => !Number.isInteger(week) || week < 1 || week > weeksCount)) {
            errors.push(`${lessonPrefix}.weeks містить тиждень поза діапазоном 1–${weeksCount}.`);
          }

          normalizedLessons.push({
            ...(typeof rawLesson.id === 'string' ? { id: rawLesson.id } : {}),
            type,
            ...(group === undefined ? {} : { group }),
            day,
            startTime,
            endTime,
            weeks,
            ...(typeof rawLesson.room === 'string' && rawLesson.room.trim() ? { room: rawLesson.room.trim() } : {}),
            format,
            teacher,
          });
        });
      }

      subjects.push({
        externalCode,
        name,
        ...(typeof rawSubject.shortName === 'string' && rawSubject.shortName.trim() ? { shortName: rawSubject.shortName.trim() } : {}),
        color: isSubjectColor(rawSubject.color) ? rawSubject.color.trim().toLowerCase() : subjectColorAt(subjectIndex),
        ...(selectedGroup === undefined ? {} : { selectedGroup }),
        lessons: normalizedLessons,
      });
    });
  }

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      schemaVersion: 1,
      semesterId: String(input.semesterId),
      subjects,
    },
  };
}

export function exportSchedule(schedule: UserSchedule): ScheduleImportV1 {
  return {
    schemaVersion: 1,
    semesterId: schedule.semester.id,
    subjects: schedule.subjects.map((subject) => ({
      externalCode: subject.externalCode ?? subject.id,
      name: subject.name,
      shortName: subject.shortName,
      color: subject.color,
      ...(subject.selectedGroup === undefined ? {} : { selectedGroup: subject.selectedGroup }),
      lessons: schedule.lessons
        .filter((lesson) => lesson.subjectId === subject.id)
        .map(({ id, type, group, day, startTime, endTime, weeks, room, format, teacher }) => ({
          id,
          type,
          ...(group === undefined ? {} : { group }),
          day,
          startTime,
          endTime,
          weeks,
          ...(room ? { room } : {}),
          format,
          teacher,
        })),
    })),
  };
}
