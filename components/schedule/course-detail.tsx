import { useMemo } from 'react';
import { Clock3, Laptop, MapPin, Radio, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LessonParticipants } from '@/components/schedule/lesson-participants';
import type {
  LessonParticipants as Participants,
  ParticipantsForLesson,
} from '@/lib/schedule/participants';
import {
  getCourseOccurrences,
  type CourseOccurrence,
} from '@/lib/schedule/course-occurrences';
import type { Lesson, Semester, Subject } from '@/lib/schedule/types';
import { dayLabels } from '@/lib/schedule/utils';

const dateLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const formatLabels = {
  online: 'Online',
  offline: 'On campus',
  hybrid: 'Hybrid',
};

function OccurrenceCard({
  occurrence,
  color,
  participants,
  ownerId,
}: {
  occurrence: CourseOccurrence;
  color: string;
  participants: Participants;
  ownerId: string;
}) {
  const { lesson, week, date } = occurrence;
  const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return (
    <li className="relative overflow-hidden rounded-[22px] border border-border bg-card p-4 shadow-[0_8px_30px_rgb(var(--theme-shadow-color)/4%)] sm:p-5">
      <span
        aria-hidden="true"
        className="absolute inset-y-5 left-0 w-[3px] rounded-r-full"
        style={{ backgroundColor: color }}
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <time
            dateTime={dateString}
            className="text-base font-semibold tracking-[-0.025em]"
          >
            {dateLabel.format(date)}
          </time>
          <div className="mt-1 text-xs text-muted-foreground">
            {dayLabels[lesson.day]} · Week {week}
          </div>
        </div>
        <Badge
          variant="secondary"
          className="rounded-full border-0 bg-secondary text-[10px]"
        >
          {lesson.type === 'lecture'
            ? 'Lecture'
            : lesson.group === undefined
              ? 'Group class'
              : `Group ${lesson.group}`}
        </Badge>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
        <Clock3
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <time dateTime={`${dateString}T${lesson.startTime}`}>
          {lesson.startTime}
        </time>
        <span>–</span>
        <time dateTime={`${dateString}T${lesson.endTime}`}>
          {lesson.endTime}
        </time>
      </div>
      <dl className="mt-3 space-y-2 text-xs text-muted-foreground sm:text-[13px]">
        <div className="flex items-start gap-2">
          <dt>
            <span className="sr-only">Teacher</span>
            <UserRound
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
          </dt>
          <dd className="min-w-0 break-words">
            {lesson.teacher || 'Teacher to be announced'}
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <dt>
            <span className="sr-only">Format</span>
            {lesson.format === 'online' ? (
              <Laptop aria-hidden="true" className="mt-0.5 size-3.5" />
            ) : lesson.format === 'hybrid' ? (
              <Radio aria-hidden="true" className="mt-0.5 size-3.5" />
            ) : (
              <MapPin aria-hidden="true" className="mt-0.5 size-3.5" />
            )}
          </dt>
          <dd>{formatLabels[lesson.format]}</dd>
        </div>
        {(lesson.room || lesson.format !== 'online') && (
          <div className="flex gap-2">
            <dt>Room</dt>
            <dd className="min-w-0 break-words">
              {lesson.room || 'To be announced'}
            </dd>
          </div>
        )}
      </dl>
      <LessonParticipants participants={participants} ownerId={ownerId} />
    </li>
  );
}

export function CourseDetail({
  subject,
  lessons,
  semester,
  participantsFor,
  ownerId,
}: {
  subject: Subject;
  lessons: Lesson[];
  semester: Semester;
  participantsFor: ParticipantsForLesson;
  ownerId: string;
}) {
  const occurrences = useMemo(
    () => getCourseOccurrences(lessons, semester, subject),
    [lessons, semester, subject],
  );
  const groups = [
    {
      type: 'lecture',
      title: 'Lectures',
      empty: 'No lectures scheduled this semester.',
    },
    {
      type: 'group',
      title: 'Group classes',
      empty: 'No group classes scheduled this semester.',
    },
  ] as const;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {subject.externalCode && (
          <span className="break-all font-mono text-xs">
            {subject.externalCode}
          </span>
        )}
        {subject.selectedGroup !== undefined && (
          <Badge variant="secondary" className="rounded-full">
            Group {subject.selectedGroup}
          </Badge>
        )}
        <span>
          {occurrences.length} {occurrences.length === 1 ? 'class' : 'classes'}{' '}
          this semester
        </span>
      </div>
      {!occurrences.length && (
        <p className="mb-6 rounded-[22px] border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
          No classes scheduled for this course this semester.
        </p>
      )}
      <div className="grid items-start gap-7 lg:grid-cols-2">
        {groups.map(({ type, title, empty }) => {
          const entries = occurrences.filter(
            ({ lesson }) => lesson.type === type,
          );
          return (
            <section key={type} aria-labelledby={`course-${type}-heading`}>
              <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                <h2
                  id={`course-${type}-heading`}
                  className="text-lg font-semibold tracking-[-0.03em]"
                >
                  {title}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {entries.length} {entries.length === 1 ? 'class' : 'classes'}
                </span>
              </div>
              {entries.length ? (
                <ol className="space-y-3">
                  {entries.map((occurrence) => (
                    <OccurrenceCard
                      key={`${occurrence.lesson.id}:${occurrence.week}`}
                      occurrence={occurrence}
                      color={subject.color}
                      participants={participantsFor(
                        occurrence.lesson,
                        occurrence.week,
                      )}
                      ownerId={ownerId}
                    />
                  ))}
                </ol>
              ) : (
                <p className="rounded-[22px] border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
                  {empty}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
