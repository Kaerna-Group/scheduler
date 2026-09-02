import { useMemo } from 'react';
import { Check, Clock3 } from 'lucide-react';
import { useMinuteClock } from '@/hooks/use-minute-clock';
import { SCHEDULE_TIME_ZONE } from '@/lib/schedule/clock';
import {
  getNextLessonState,
  minutesRemaining,
} from '@/lib/schedule/next-lesson';
import type { TimedLesson } from '@/lib/schedule/next-lesson';
import type { ScheduleSource, UserSchedule } from '@/lib/schedule/types';

function LessonRows({
  entries,
  current,
  now,
}: {
  entries: TimedLesson[];
  current: boolean;
  now: number;
}) {
  return entries.map(({ lesson, subject, start, end }) => {
    const place =
      lesson.format === 'online'
        ? 'Онлайн'
        : lesson.format === 'hybrid'
          ? `Гібрид${lesson.room ? ` · ${lesson.room}` : ''}`
          : lesson.room || 'Аудиторію не вказано';
    return (
      <p
        key={lesson.id}
        className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm leading-6"
      >
        <span className="text-muted-foreground">
          {current ? 'Зараз:' : 'Наступна:'}
        </span>
        <span
          className="min-w-0 break-words font-semibold"
          title={`${subject.name} · ${lesson.type === 'lecture' ? 'Лекція' : `Група ${lesson.group}`}`}
        >
          {subject.shortName || subject.name}
        </span>
        <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums">
            {lesson.startTime}
            {current ? `–${lesson.endTime}` : ''}
          </span>
        </span>
        <span className="inline-flex min-w-0 items-baseline gap-2 text-muted-foreground">
          <span className="shrink-0" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 break-words">{place}</span>
        </span>
        <span className="whitespace-nowrap font-medium text-primary">
          · {current ? 'ще' : 'через'}{' '}
          {minutesRemaining((current ? end : start) - now)}
        </span>
      </p>
    );
  });
}

export function NextLessonBanner({
  schedule,
  source,
  loading,
  ready,
  online,
  backendError,
}: {
  schedule: UserSchedule;
  source: ScheduleSource;
  loading: boolean;
  ready: boolean;
  online: boolean;
  backendError: boolean;
}) {
  const now = useMinuteClock();
  const state = useMemo(
    () => getNextLessonState(schedule, now),
    [schedule, now],
  );
  const message = loading
    ? 'Оновлюємо розклад…'
    : !ready
      ? 'Розклад недоступний'
      : {
          'before-semester': 'Семестр ще не розпочався',
          'after-semester': 'Семестр завершено',
          'free-day': 'Сьогодні пар немає',
          done: 'На сьогодні все',
          unavailable: 'Не вдалося визначити наступну пару',
          lessons: '',
        }[state.kind];
  const note =
    !ready || loading
      ? ''
      : source === 'fallback'
        ? 'Приклад розкладу'
        : !online
          ? 'Офлайн · збережені дані'
          : source === 'cache' || backendError
            ? 'Збережені дані'
            : '';
  const finished =
    !loading && ready && (state.kind === 'done' || state.kind === 'free-day');
  return (
    <section
      aria-label="Найближча пара"
      lang="uk"
      className="mb-4 flex items-start gap-3 rounded-2xl border border-border bg-card/70 px-4 py-3 sm:items-center"
    >
      <span className="mt-0.5 text-muted-foreground sm:mt-0" aria-hidden="true">
        {finished ? (
          <Check className="size-4 text-success" />
        ) : (
          <Clock3 className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span title={SCHEDULE_TIME_ZONE}>Сьогодні · Київ</span>
          {note && <span className="text-warning-foreground">· {note}</span>}
          {!message &&
            state.kind === 'lessons' &&
            (state.current.length > 1 || state.next.length > 1) && (
              <span className="text-destructive">· Одночасні пари</span>
            )}
        </div>
        {message ? (
          <p className="text-sm font-medium leading-6">{message}</p>
        ) : (
          state.kind === 'lessons' && (
            <>
              <LessonRows entries={state.current} current now={now} />
              <LessonRows entries={state.next} current={false} now={now} />
            </>
          )
        )}
      </div>
    </section>
  );
}
