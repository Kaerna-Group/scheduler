export type WeekDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

export type LessonType = 'lecture' | 'group';
export type LessonFormat = 'offline' | 'online' | 'hybrid';

export interface Subject {
  id: string;
  name: string;
  shortName: string;
  color: string;
}

export interface Lesson {
  id: string;
  subjectId: string;
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
  title: string;
  weeksCount: number;
  startDate: string;
}
