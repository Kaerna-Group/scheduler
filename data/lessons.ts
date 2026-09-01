import type { Lesson } from '@/lib/schedule/types';
import { weeks } from '@/lib/schedule/weeks';

export const lessons: Lesson[] = [
  {
    id: 'electronics-group-5', subjectId: 'electronics', type: 'group', group: 5,
    day: 'wednesday', startTime: '11:40', endTime: '13:00', weeks: weeks(4, 12),
    room: '1-001', format: 'offline', teacher: 'І. Раєць',
  },
  {
    id: 'electronics-lecture', subjectId: 'electronics', type: 'lecture',
    day: 'saturday', startTime: '08:30', endTime: '09:50', weeks: weeks(3, 11),
    room: '1-310', format: 'offline', teacher: 'Я. І. Вознюк',
  },
  {
    id: 'scrum-framework-lecture', subjectId: 'scrum-framework', type: 'lecture',
    day: 'thursday', startTime: '10:00', endTime: '11:20', weeks: weeks(1, 7),
    format: 'online', teacher: 'О. О. Палієнко',
  },
  {
    id: 'scrum-framework-group-1', subjectId: 'scrum-framework', type: 'group', group: 1,
    day: 'thursday', startTime: '11:40', endTime: '13:00', weeks: weeks(1, 7),
    format: 'online', teacher: 'О. О. Палієнко',
  },
  {
    id: 'scrum-framework-group-2', subjectId: 'scrum-framework', type: 'group', group: 2,
    day: 'thursday', startTime: '13:30', endTime: '14:50', weeks: weeks(1, 7),
    format: 'online', teacher: 'О. О. Палієнко',
  },
  {
    id: 'scrum-framework-group-3', subjectId: 'scrum-framework', type: 'group', group: 3,
    day: 'thursday', startTime: '15:00', endTime: '16:20', weeks: weeks(1, 7),
    format: 'online', teacher: 'О. О. Палієнко',
  },
  {
    id: 'web-security-lecture', subjectId: 'web-security', type: 'lecture',
    day: 'friday', startTime: '10:00', endTime: '11:20', weeks: weeks(1, 10),
    room: '1-225', format: 'offline', teacher: 'Т. А. Бабич',
  },
  {
    id: 'web-security-group-4', subjectId: 'web-security', type: 'group', group: 4,
    day: 'friday', startTime: '16:30', endTime: '17:50', weeks: weeks(1, 10),
    room: '1-331', format: 'offline', teacher: 'Т. А. Бабич',
  },
  {
    id: 'cryptonomics-lecture', subjectId: 'cryptonomics', type: 'lecture',
    day: 'friday', startTime: '08:30', endTime: '09:50', weeks: weeks(3, 12),
    room: '1-223', format: 'hybrid', teacher: 'К. С. Гороховський',
  },
  {
    id: 'cryptonomics-group-2', subjectId: 'cryptonomics', type: 'group', group: 2,
    day: 'saturday', startTime: '11:40', endTime: '13:00', weeks: weeks(3, 12),
    format: 'online', teacher: 'К. С. Гороховський',
  },
  {
    id: 'coding-systems-lecture', subjectId: 'coding-systems', type: 'lecture',
    day: 'saturday', startTime: '08:30', endTime: '09:50', weeks: [1, 3, 5, 7, 9, 11, 12],
    format: 'online', teacher: "П. Г. Прокоф'єв",
  },
  {
    id: 'coding-systems-group-1', subjectId: 'coding-systems', type: 'group', group: 1,
    day: 'saturday', startTime: '10:00', endTime: '11:20', weeks: weeks(1, 14),
    format: 'online', teacher: "П. Г. Прокоф'єв",
  },
  {
    id: 'intelligent-networks-lecture', subjectId: 'intelligent-networks', type: 'lecture',
    day: 'thursday', startTime: '08:30', endTime: '09:50', weeks: [1, 3, 5, 7, 9, 11, 13],
    format: 'online', teacher: 'Н. Луцька',
  },
  {
    id: 'intelligent-networks-group-4', subjectId: 'intelligent-networks', type: 'group', group: 4,
    day: 'thursday', startTime: '15:00', endTime: '16:20', weeks: weeks(1, 14),
    format: 'online', teacher: 'Н. Луцька',
  },
  {
    id: 'parallel-programming-lecture', subjectId: 'parallel-programming', type: 'lecture',
    day: 'wednesday', startTime: '10:00', endTime: '11:20', weeks: weeks(2, 12),
    format: 'online', teacher: 'Г. І. Малашонок',
  },
  {
    id: 'parallel-programming-group-2', subjectId: 'parallel-programming', type: 'group', group: 2,
    day: 'wednesday', startTime: '13:30', endTime: '14:50', weeks: weeks(2, 12),
    format: 'online', teacher: 'Г. І. Малашонок',
  },
];
