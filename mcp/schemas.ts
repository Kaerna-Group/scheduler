import * as z from 'zod';

// These schemas describe the supported transport contract. Apps Script remains
// the authority for permissions, references, conflicts and the saved mutation.
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/);
const text = z.string().min(1).max(500);
const day = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weeks = z.array(z.number().int().min(1).max(30)).min(1).max(30);
const selection = {
  weeks: weeks.optional(),
  fromWeek: z.number().int().min(1).max(30).optional(),
};
const groupIds = z.array(id).max(100);
const lessonFields = z.strictObject({
  type: z.enum(['lecture', 'group']),
  day,
  startTime: time,
  endTime: time,
  format: z.enum(['online', 'offline', 'hybrid']),
  teacher: text,
  weeks,
  room: z.string().max(500).optional(),
  groupIds: groupIds.optional(),
});
const subjectFields = z.strictObject({
  name: text,
  shortName: text,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
const offeringFields = z.strictObject({
  semesterId: id,
  subjectId: id,
  externalCode: text,
});
const groupFields = z.strictObject({
  offeringId: id,
  groupNumber: z.number().int().min(1).max(999),
  label: text,
});
const semesterFields = z.strictObject({
  title: text,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weeksCount: z.number().int().min(1).max(30),
});

export const command = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('lesson.create'),
    offeringId: id,
    fields: lessonFields,
  }),
  z.strictObject({
    type: z.literal('lesson.update'),
    lessonId: id,
    fields: lessonFields.partial(),
  }),
  z.strictObject({
    type: z.literal('lesson.move'),
    lessonId: id,
    startTime: time,
    day: day.optional(),
    ...selection,
  }),
  z.strictObject({
    type: z.literal('lesson.cancel'),
    lessonId: id,
    ...selection,
  }),
  z.strictObject({
    type: z.literal('subject.create'),
    id: id.optional(),
    fields: subjectFields,
  }),
  z.strictObject({
    type: z.literal('subject.update'),
    id,
    fields: subjectFields.partial(),
  }),
  z.strictObject({ type: z.literal('subject.archive'), id }),
  z.strictObject({
    type: z.literal('subject.merge'),
    targetSubjectId: id,
    sourceSubjectIds: z.array(id).min(1).max(50),
  }),
  z.strictObject({
    type: z.literal('offering.create'),
    id: id.optional(),
    fields: offeringFields,
  }),
  z.strictObject({
    type: z.literal('offering.update'),
    id,
    fields: offeringFields.pick({ externalCode: true }).partial(),
  }),
  z.strictObject({ type: z.literal('offering.archive'), id }),
  z.strictObject({
    type: z.literal('group.create'),
    id: id.optional(),
    fields: groupFields,
  }),
  z.strictObject({
    type: z.literal('group.update'),
    id,
    fields: groupFields.omit({ offeringId: true }).partial(),
  }),
  z.strictObject({ type: z.literal('group.archive'), id }),
  z.strictObject({
    type: z.literal('semester.create'),
    id,
    fields: semesterFields,
  }),
  z.strictObject({
    type: z.literal('semester.update'),
    id,
    fields: semesterFields.partial(),
  }),
  z.strictObject({ type: z.literal('semester.archive'), id }),
  z.strictObject({ type: z.literal('semester.setCurrent'), id }),
  z.strictObject({
    type: z.literal('enrollment.add'),
    userId: id,
    offeringId: id,
    groupId: id.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal('enrollment.changeGroup'),
    enrollmentId: id,
    groupId: id.nullable(),
  }),
  z.strictObject({ type: z.literal('enrollment.remove'), enrollmentId: id }),
  z.strictObject({ type: z.literal('changes.undo'), operationId: id }),
]);

export const planInput = z.strictObject({
  commands: z.array(command).min(1).max(30),
  reason: z.string().max(500).optional(),
});
export const lessonFilters = z.strictObject({
  semesterId: id.optional(),
  course: text.optional(),
  offeringId: id.optional(),
  lessonId: id.optional(),
  type: z.enum(['lecture', 'group']).optional(),
  day: day.optional(),
  startTime: time.optional(),
});
export const applyInput = z.strictObject({
  planId: id.describe('Exact ID returned by scheduler_changes_plan.'),
  operationId: id.describe(
    'Choose and retain a unique ID before apply. Reuse this exact ID after an uncertain response.',
  ),
  confirmPlanId: id
    .optional()
    .describe(
      'Only supply the exact plan ID after the user separately approved its confirmationReasons. Never fill this automatically.',
    ),
});
