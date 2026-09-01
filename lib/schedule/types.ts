export type WeekDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export type LessonType = 'lecture' | 'group';
export type LessonFormat = 'offline' | 'online' | 'hybrid';
export type UserRole = 'user' | 'editor' | 'admin';

export interface ScheduleUser {
  id: string;
  slug: string;
  displayName: string;
  role: UserRole;
}

export interface Subject {
  id: string;
  name: string;
  shortName: string;
  color: string;
  offeringId?: string;
  externalCode?: string;
  selectedGroup?: number;
  availableGroups?: number[];
}

export interface Lesson {
  id: string;
  subjectId: string;
  offeringId?: string;
  type: LessonType;
  group?: number;
  day: WeekDay;
  startTime: string;
  endTime: string;
  weeks: number[];
  room?: string;
  format: LessonFormat;
  teacher: string;
}

export interface Semester {
  id: string;
  title: string;
  weeksCount: number;
  startDate: string;
}

export interface UserSchedule {
  users: ScheduleUser[];
  user: ScheduleUser;
  semester: Semester;
  subjects: Subject[];
  lessons: Lesson[];
  revision: number;
  preferences?: import('@/lib/preferences/types').SchedulerPreferences;
  preferencesRevision?: number;
  preferencesExists?: boolean;
}

export interface ImportLesson {
  id?: string;
  type: LessonType;
  group?: number;
  day: WeekDay;
  startTime: string;
  endTime: string;
  weeks: number[];
  room?: string;
  format: LessonFormat;
  teacher: string;
}

export interface ImportSubject {
  externalCode: string;
  name: string;
  shortName?: string;
  color?: string;
  selectedGroup?: number;
  lessons?: ImportLesson[];
}

export interface ScheduleImportV1 {
  schemaVersion: 1;
  semesterId: string;
  subjects: ImportSubject[];
}

export type ScheduleSource = 'remote' | 'cache' | 'fallback';
