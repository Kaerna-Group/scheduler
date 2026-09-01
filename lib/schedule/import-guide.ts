import type { ScheduleImportV1 } from '@/lib/schedule/types';

export const scheduleImportExample: ScheduleImportV1 = {
  schemaVersion: 1,
  semesterId: 'SEM-2026-FALL',
  subjects: [
    {
      externalCode: '565095',
      name: 'Scrum Framework Fundamentals',
      shortName: 'Scrum Fundamentals',
      color: '#7b86c6',
      selectedGroup: 3,
      lessons: [
        {
          type: 'lecture',
          day: 'thursday',
          startTime: '10:00',
          endTime: '11:20',
          weeks: [1, 2, 3, 4, 5, 6, 7],
          format: 'online',
          teacher: 'O. O. Paliienko',
        },
        {
          type: 'group',
          group: 1,
          day: 'thursday',
          startTime: '11:40',
          endTime: '13:00',
          weeks: [1, 2, 3, 4, 5, 6, 7],
          format: 'online',
          teacher: 'O. O. Paliienko',
        },
        {
          type: 'group',
          group: 2,
          day: 'thursday',
          startTime: '13:30',
          endTime: '14:50',
          weeks: [1, 2, 3, 4, 5, 6, 7],
          format: 'online',
          teacher: 'O. O. Paliienko',
        },
        {
          type: 'group',
          group: 3,
          day: 'thursday',
          startTime: '15:00',
          endTime: '16:20',
          weeks: [1, 2, 3, 4, 5, 6, 7],
          format: 'online',
          teacher: 'O. O. Paliienko',
        },
      ],
    },
    {
      externalCode: 'LOCAL-QUALIFICATION',
      name: 'Qualification Project',
      shortName: 'Qualification Project',
      color: '#a276c7',
      selectedGroup: 2,
      lessons: [],
    },
  ],
};

export function buildLlmImportPrompt(semesterId: string, weeksCount: number) {
  return `Convert the provided schedule into JSON for importing into the site. Return ONLY valid JSON: no Markdown, no \`\`\`, no comments, and no explanations.

Root format:
{
  "schemaVersion": 1,
  "semesterId": "${semesterId}",
  "subjects": []
}

Required rules:
1. schemaVersion must be exactly the number 1.
2. semesterId must be exactly the string "${semesterId}".
3. subjects must be an array of courses. Each externalCode must be unique within the file.
4. externalCode must be the stable course code from the source. Do not invent a new code when one is known. If there is no code, create one stable code in the form LOCAL-LATIN-SLUG and reuse it in later imports.
5. name and externalCode are required. shortName, color, selectedGroup, and lessons are optional.
6. If provided, color must use #RRGGBB. selectedGroup must be a positive integer.
7. selectedGroup is the user's personal choice, not a property of the entire course. For example, a user in group 3 specifies selectedGroup: 3.
8. lessons belong to the shared course. Include shared lectures and lessons for the selected group that actually appear in the source schedule. Do not invent lessons for other groups: the server preserves known groups and adds the new group automatically.
9. A course without recurring lessons is valid: "lessons": [].
10. One lesson object represents one immutable occurrence rule: one day, time, type, format, teacher, room, and group number for the specified set of weeks.
11. If the day, time, format, room, teacher, type, or group changes between weeks, split it into multiple lesson objects.
12. type must be exactly "lecture" or "group". For type="group", group is required and must be a positive integer. Omit group for a shared lecture; it is allowed for a group-specific lecture.
13. day must be "monday", "tuesday", "wednesday", "thursday", "friday", or "saturday". Sunday is not supported.
14. startTime and endTime must use HH:mm with a leading zero; start must precede end; overnight lessons are forbidden.
15. weeks must be a non-empty ascending array of unique integers from 1 to ${weeksCount}. Do not use strings, ranges such as "1-14", or words such as "even/odd".
16. format must be exactly "offline", "online", or "hybrid".
17. teacher is a required non-empty string. Use "Vacancy" when no teacher is assigned.
18. room is optional. It is normally omitted for online lessons; provide it for offline lessons when known.
19. Prefer omitting lesson id: the server creates internal identifiers.
20. Field names and letter case must match the schema. Do not add unknown fields.
21. Do not combine different lessons into one lesson object. Do not create separate subjects for the lecture and practice of the same course.
22. Preserve the source spelling of course names, teachers, and rooms. Do not infer missing information except for the LOCAL code and "Vacancy" value described above.

Example of a valid result:
${JSON.stringify(scheduleImportExample, null, 2)}

Now convert the schedule that the user sends next.`;
}
