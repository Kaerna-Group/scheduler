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
  groups?: number[];
  day: WeekDay;
  startTime: string;
  endTime: string;
  weeks: number[];
  room?: string;
  format: LessonFormat;
  teacher: string;
}

export interface LessonParticipantEntry {
  lessonId: string;
  week: number;
  userIds: string[];
}

export interface Semester {
  id: string;
  title: string;
  weeksCount: number;
  startDate: string;
}

export interface SemesterSummary extends Semester {
  archived: boolean;
  current: boolean;
}

export interface UserSchedule {
  users: ScheduleUser[];
  user: ScheduleUser;
  semester: Semester;
  semesters?: SemesterSummary[];
  currentSemesterId?: string;
  subjects: Subject[];
  lessons: Lesson[];
  lessonParticipants?: LessonParticipantEntry[];
  participantUserCount?: number;
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

export type SharedConflictResolution = 'keep' | 'apply';

export interface ImportPlanChange {
  action: string;
  entityType: string;
  entityId: string;
  externalCode?: string;
  partOfReplacement?: boolean;
  oldValue: unknown;
  newValue: unknown;
}

export interface ImportSharedConflict {
  code: 'COURSE_DATA_CONFLICT';
  kind?: 'subject' | 'lesson';
  externalCode: string;
  offeringId: string;
  resolution?: SharedConflictResolution;
  stored: unknown;
  imported: unknown;
}

export interface ImportPlanResponse {
  schedule?: UserSchedule;
  revision: number;
  plan: ImportPlanChange[];
  conflicts?: ImportSharedConflict[];
}

export type ScheduleSource = 'remote' | 'cache' | 'fallback';
