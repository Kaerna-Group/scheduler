'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpenText, CalendarDays,
  ChevronDown, Clock3, CloudOff, FileJson2, Laptop, MapPin, Radio, RefreshCw, Sparkles, UserRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSchedule } from '@/hooks/use-schedule';
import type { Lesson, Subject, WeekDay } from '@/lib/schedule/types';
import {
  dayLabels, dayLabelsShort, dayOrder, getConflictIds, getCurrentWeekDay,
  getLessonsForDay, getSemesterWeek, getWeekDates,
} from '@/lib/schedule/utils';
import { cn } from '@/lib/utils';

type ViewMode = 'week' | 'today' | 'subjects';

const monthNames = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

function LessonCard({ lesson, subject, hasConflict }: { lesson: Lesson; subject: Subject; hasConflict: boolean }) {
  const place = lesson.format === 'online'
    ? 'Дистанційно'
    : lesson.format === 'hybrid'
      ? `Гібридно${lesson.room ? ` · ${lesson.room}` : ''}`
      : lesson.room ?? 'Аудиторія уточнюється';

  return (
    <article className={cn(
      'group relative overflow-hidden rounded-[22px] border bg-card p-4 shadow-[0_8px_30px_rgb(33_39_42/5%)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_38px_rgb(33_39_42/9%)] sm:p-5',
      hasConflict ? 'border-[#e3aaa3]' : 'border-[#e7e5de]',
    )}>
      <span aria-hidden="true" className="absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: subject.color }} />
      <div className="flex items-start gap-4">
        <div className="w-[54px] shrink-0 pt-0.5">
          <div className="text-[17px] font-semibold tracking-[-0.03em] text-foreground">{lesson.startTime}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{lesson.endTime}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full border-0 bg-[#f0eee8] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#65635d]">
              {lesson.type === 'lecture' ? 'Лекція' : `Група ${lesson.group}`}
            </Badge>
            {hasConflict && (
              <Badge className="rounded-full border-0 bg-[#fff0ed] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#b34e43]">
                <AlertTriangle className="size-3" /> Конфлікт
              </Badge>
            )}
          </div>
          <h3 className="mt-2.5 max-w-2xl text-[16px] font-semibold leading-[1.35] tracking-[-0.025em] text-[#242a2c] sm:text-[17px]">{subject.name}</h3>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#6f716d] sm:text-[13px]">
            <span className="flex items-center gap-1.5">
              {lesson.format === 'online' ? <Laptop className="size-3.5" /> : lesson.format === 'hybrid' ? <Radio className="size-3.5" /> : <MapPin className="size-3.5" />}
              {place}
            </span>
            <span className="flex items-center gap-1.5"><UserRound className="size-3.5" />{lesson.teacher}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function DaySection({ sourceLessons, sourceSubjects, day, date, week, subjectId, conflictIds, compact = false }: {
  sourceLessons: Lesson[]; sourceSubjects: Subject[]; day: WeekDay; date: Date; week: number;
  subjectId: string; conflictIds: Set<string>; compact?: boolean;
}) {
  const dayLessons = getLessonsForDay(sourceLessons, week, day, subjectId);
  if (!dayLessons.length && compact) return null;

  return (
    <section className="scroll-mt-28" id={day}>
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-[#293033]">{dayLabels[day]}</h2>
          <span className="text-sm font-medium text-[#9b9b93]">{date.getDate()} {monthNames[date.getMonth()]}</span>
        </div>
        {dayLessons.length > 0 && <span className="text-xs font-medium text-[#a0a09a]">{dayLessons.length} {dayLessons.length === 1 ? 'пара' : 'пари'}</span>}
      </div>
      {dayLessons.length ? (
        <div className="space-y-3">
          {dayLessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              subject={sourceSubjects.find((item) => item.id === lesson.subjectId)!}
              hasConflict={conflictIds.has(lesson.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[22px] border border-dashed border-[#ddd9cf] px-5 py-8 text-center text-sm text-[#9a9890]">Вільний день — пар немає</div>
      )}
    </section>
  );
}

function SubjectCatalog({ subjects, lessons }: { subjects: Subject[]; lessons: Lesson[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {subjects.map((subject) => {
        const subjectLessons = lessons.filter((lesson) => lesson.subjectId === subject.id);
        return (
          <article key={subject.id} className="relative overflow-hidden rounded-[22px] border border-[#e5e1d7] bg-white/75 p-5 shadow-[0_8px_30px_rgb(33_39_42/4%)]">
            <span className="absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: subject.color }} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#9a978e]">{subject.externalCode ?? 'Без коду'}</div>
                <h2 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.025em] text-[#2d3537]">{subject.name}</h2>
              </div>
              {subject.selectedGroup !== undefined && (
                <Badge variant="secondary" className="shrink-0 rounded-full border-0 bg-[#efede7] text-[10px]">Група {subject.selectedGroup}</Badge>
              )}
            </div>
            <div className="mt-4 text-xs text-[#777a76]">
              {subjectLessons.length ? `${subjectLessons.length} правил розкладу` : 'Дисципліна без регулярних занять'}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ScheduleApp() {
  const {
    schedule, selectedUser, selectUser, source, loading, error,
    refresh, remoteConfigured,
  } = useSchedule();
  const { lessons, subjects, semester } = schedule;
  const currentWeek = getSemesterWeek(semester.startDate, semester.weeksCount);
  const currentDay = getCurrentWeekDay();
  const [week, setWeek] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('scheduler_selected_week_v1'));
      return Number.isInteger(stored) && stored >= 1 && stored <= semester.weeksCount ? stored : currentWeek;
    } catch {
      return currentWeek;
    }
  });
  const [view, setView] = useState<ViewMode>('week');
  const [subjectId, setSubjectId] = useState('all');

  const chooseWeek = (value: number) => {
    setWeek(value);
    try { localStorage.setItem('scheduler_selected_week_v1', String(value)); } catch { /* preference only */ }
  };

  const dates = useMemo(() => getWeekDates(semester.startDate, week), [semester.startDate, week]);
  const conflictIds = useMemo(() => getConflictIds(lessons, week), [lessons, week]);
  const activeLessons = useMemo(() => lessons.filter((lesson) => lesson.weeks.includes(week) && (subjectId === 'all' || lesson.subjectId === subjectId)), [lessons, week, subjectId]);
  const conflictCount = activeLessons.filter((lesson) => conflictIds.has(lesson.id)).length;
  const visibleDays = view === 'today' ? (currentDay ? [currentDay] : []) : dayOrder;
  const visibleLessonCount = view === 'today' && currentDay
    ? activeLessons.filter((lesson) => lesson.day === currentDay).length
    : activeLessons.length;

  const goToToday = () => {
    chooseWeek(currentWeek);
    setView('today');
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-20 -top-28 size-[380px] rounded-full bg-[#e8e2d2]/45 blur-3xl" />
        <div className="absolute -left-32 top-[38%] size-[340px] rounded-full bg-[#d9e7e5]/45 blur-3xl" />
      </div>

      <header className="relative border-b border-[#e8e4da]/80 bg-[#f8f6f0]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-[14px] bg-[#263335] text-[#f8f6f0] shadow-sm"><CalendarDays className="size-[19px]" strokeWidth={1.8} /></div>
            <div>
              <div className="text-[15px] font-bold tracking-[-0.02em] text-[#273034]">Мій розклад</div>
              <div className="text-[11px] font-medium text-[#8c8c84]">{semester.title}</div>
            </div>
          </div>

          <label className="relative order-3 flex h-10 min-w-[150px] flex-1 items-center gap-2 rounded-full border border-[#dedacf] bg-white/75 px-3.5 text-xs text-[#626764] sm:order-none sm:max-w-[190px]">
            <UserRound className="size-3.5 shrink-0 text-[#7e8986]" />
            <select
              value={selectedUser}
              onChange={(event) => {
                setSubjectId('all');
                selectUser(event.target.value);
              }}
              className="min-w-0 flex-1 appearance-none bg-transparent pr-5 font-semibold outline-none"
              aria-label="Користувач розкладу"
            >
              {schedule.users.map((user) => <option key={user.id} value={user.slug}>{user.displayName}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 size-3.5" />
          </label>

          <nav className="hidden items-center rounded-full border border-[#e2ded4] bg-white/70 p-1 md:flex" aria-label="Вигляд розкладу">
            {([['today', 'Сьогодні'], ['week', 'Тиждень'], ['subjects', 'Предмети']] as const).map(([value, label]) => (
              <button key={value} onClick={() => setView(value)} className={cn(
                'rounded-full px-4 py-2 text-xs font-semibold transition',
                view === value ? 'bg-[#293638] text-white shadow-sm' : 'text-[#777872] hover:text-[#293638]',
              )}>{label}</button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a href="#/import" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-[#dedacf] bg-white/80 px-3.5 text-xs font-semibold text-[#293638] transition hover:bg-white">
              <FileJson2 className="size-3.5" />
              <span className="hidden sm:inline">Імпорт</span>
            </a>
            <Button variant="outline" onClick={goToToday} className="h-10 rounded-full border-[#dedacf] bg-white/80 px-4 text-xs font-semibold text-[#394346] shadow-none hover:bg-white">
              <Sparkles className="size-3.5 text-[#e08b5b]" />
              <span className="hidden xl:inline">До сьогодні</span>
              <span className="xl:hidden">Сьогодні</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1240px] px-4 pb-24 pt-6 sm:px-7 sm:pt-8 lg:px-10">
        <section className="rounded-[26px] border border-[#e5e1d7] bg-white/70 p-4 shadow-[0_16px_55px_rgb(46_52_50/5%)] backdrop-blur-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button aria-label="Попередній тиждень" variant="outline" size="icon-lg" disabled={week === 1} onClick={() => chooseWeek(Math.max(1, week - 1))} className="rounded-full border-[#dfdbd1] bg-white shadow-none"><ArrowLeft /></Button>
              <div className="min-w-[132px] text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#a09d93]">Навчальний</div>
                <div className="mt-0.5 text-xl font-semibold tracking-[-0.04em] text-[#263033]">{week} тиждень</div>
              </div>
              <Button aria-label="Наступний тиждень" variant="outline" size="icon-lg" disabled={week === semester.weeksCount} onClick={() => chooseWeek(Math.min(semester.weeksCount, week + 1))} className="rounded-full border-[#dfdbd1] bg-white shadow-none"><ArrowRight /></Button>
            </div>

            <label className="relative flex min-w-[230px] flex-1 items-center gap-2 rounded-full border border-[#dfdbd1] bg-white px-4 py-2.5 text-xs text-[#686b68] sm:max-w-[290px]">
              <BookOpenText className="size-4 shrink-0 text-[#88918f]" />
              <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className="min-w-0 flex-1 appearance-none bg-transparent pr-6 font-semibold outline-none" aria-label="Фільтр за предметом">
                <option value="all">Усі дисципліни</option>
                {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.shortName}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 size-3.5" />
            </label>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
            {Array.from({ length: semester.weeksCount }, (_, index) => index + 1).map((value) => (
              <button key={value} aria-label={`${value} тиждень`} aria-current={week === value ? 'true' : undefined} onClick={() => { chooseWeek(value); if (view === 'today') setView('week'); }} className={cn(
                'h-9 rounded-[12px] text-xs font-semibold transition sm:h-10',
                week === value ? 'bg-[#e9915e] text-white shadow-[0_6px_16px_rgb(233_145_94/25%)]' : 'bg-[#f4f2ec] text-[#73746f] hover:bg-[#ebe8df] hover:text-[#313a3c]',
              )}>{value}</button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#ebe7dd] pt-3 text-[11px] text-[#8d8e88]">
            <span className="flex items-center gap-1.5">
              {source === 'remote' ? <Sparkles className="size-3.5 text-[#5f8b70]" /> : <CloudOff className="size-3.5 text-[#c17a50]" />}
              {source === 'remote' ? `Дані синхронізовано · revision ${schedule.revision}` : source === 'cache' ? `Показано кеш · revision ${schedule.revision}` : 'Показано резервні дані'}
            </span>
            <Button variant="ghost" size="xs" disabled={loading || !remoteConfigured} onClick={refresh} className="rounded-full px-2.5">
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Оновити
            </Button>
          </div>
          {error && <div className="mt-3 rounded-[12px] bg-[#fff0ed] px-3 py-2 text-xs text-[#a85b50]">{error}</div>}
        </section>

        <nav className="sticky top-3 z-20 mt-4 flex gap-2 overflow-x-auto rounded-[18px] border border-[#e5e1d7] bg-[#f8f6f0]/90 p-2 shadow-sm backdrop-blur-xl md:hidden" aria-label="Дні тижня">
          {dayOrder.map((day) => (
            <a key={day} href={`#${day}`} className="flex min-w-[48px] flex-1 flex-col items-center rounded-[12px] px-2 py-2 text-xs font-semibold text-[#747570] hover:bg-white">
              {dayLabelsShort[day]}<span className="mt-0.5 text-[10px] font-medium text-[#aaa79e]">{dates[day].getDate()}</span>
            </a>
          ))}
        </nav>

        <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
          <div>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9a978e]">{view === 'today' ? 'На сьогодні' : view === 'subjects' ? 'За дисципліною' : 'Огляд тижня'}</p>
                <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.055em] text-[#273033] sm:text-[38px]">
                  {view === 'subjects' ? `${subjects.length} дисциплін` : `${visibleLessonCount} занять`}
                </h1>
              </div>
              <div className="text-right text-xs leading-relaxed text-[#95958e]">{dates.monday.getDate()} {monthNames[dates.monday.getMonth()]} — {dates.saturday.getDate()} {monthNames[dates.saturday.getMonth()]}</div>
            </div>

            <div className="space-y-8">
              {view === 'subjects' ? (
                <SubjectCatalog subjects={subjects} lessons={lessons} />
              ) : visibleDays.map((day) => (
                <DaySection
                  key={day}
                  sourceLessons={lessons}
                  sourceSubjects={subjects}
                  day={day}
                  date={dates[day]}
                  week={week}
                  subjectId={subjectId}
                  conflictIds={conflictIds}
                />
              ))}
              {view !== 'subjects' && visibleDays.length === 0 && (
                <div className="rounded-[24px] border border-dashed border-[#ddd9cf] px-6 py-12 text-center text-sm text-[#8f918c]">
                  Сьогодні вихідний — навчальних пар немає
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="overflow-hidden rounded-[24px] bg-[#293638] p-5 text-white shadow-[0_18px_45px_rgb(41_54_56/15%)]">
              <div className="flex items-start justify-between gap-4">
                <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Цей тиждень</div><div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{activeLessons.length} пар</div></div>
                <div className="grid size-10 place-items-center rounded-[13px] bg-white/10"><Clock3 className="size-[18px] text-[#f3b18a]" /></div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                <div><div className="text-[10px] font-medium text-white/45">Онлайн</div><div className="mt-1 text-lg font-semibold">{activeLessons.filter((item) => item.format === 'online').length}</div></div>
                <div><div className="text-[10px] font-medium text-white/45">В аудиторії</div><div className="mt-1 text-lg font-semibold">{activeLessons.filter((item) => item.format !== 'online').length}</div></div>
              </div>
            </div>

            <div className={cn('rounded-[24px] border p-5', conflictCount ? 'border-[#e6b8b1] bg-[#fff5f2]' : 'border-[#dce5df] bg-[#f4f8f4]')}>
              <div className="flex gap-3">
                <div className={cn('grid size-9 shrink-0 place-items-center rounded-full', conflictCount ? 'bg-[#f9dcd7] text-[#b55549]' : 'bg-[#dfece3] text-[#557662]')}>
                  {conflictCount ? <AlertTriangle className="size-4" /> : <Sparkles className="size-4" />}
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-[-0.02em] text-[#343b3d]">{conflictCount ? 'Є перетини в розкладі' : 'Усе чисто'}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-[#747873]">{conflictCount ? `${conflictCount} занять відбуваються одночасно. Вони позначені у стрічці.` : 'На цьому тижні заняття не перетинаються за часом.'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[#e5e1d7] bg-white/60 p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9b988f]">Позначення</div>
              <div className="mt-4 space-y-3 text-xs text-[#6e716d]">
                <div className="flex items-center gap-2.5"><Laptop className="size-4 text-[#798b88]" /> Дистанційне заняття</div>
                <div className="flex items-center gap-2.5"><MapPin className="size-4 text-[#798b88]" /> Заняття в аудиторії</div>
                <div className="flex items-center gap-2.5"><Radio className="size-4 text-[#798b88]" /> Гібридний формат</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
