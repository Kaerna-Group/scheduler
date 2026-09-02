'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, BookOpenText, CalendarDays,
  Clock3, CloudOff, FileJson2, History, Laptop, MapPin, Radio, RefreshCw, Settings2, Sparkles, UserRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { AdminLink } from '@/components/admin/admin-link';
import { SemesterSelect } from '@/components/schedule/semester-select';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { useSchedule } from '@/hooks/use-schedule';
import { usePreferences } from '@/hooks/use-preferences';
import { useTheme } from '@/hooks/use-theme';
import { getScheduleSyncStatus } from '@/lib/schedule/sync-status';
import type { Lesson, Subject, WeekDay } from '@/lib/schedule/types';
import {
  dayLabels, dayLabelsShort, dayOrder, getConflictIds, getCurrentWeekDay,
  getLessonsForDay, getSemesterWeek, getWeekDates,
} from '@/lib/schedule/utils';
import { cn } from '@/lib/utils';

type ViewMode = 'week' | 'today' | 'subjects';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function LessonCard({ lesson, subject, hasConflict, compact }: { lesson: Lesson; subject: Subject; hasConflict: boolean; compact: boolean }) {
  const place = lesson.format === 'online'
    ? 'Online'
    : lesson.format === 'hybrid'
      ? `Hybrid${lesson.room ? ` · ${lesson.room}` : ''}`
      : lesson.room ?? 'Room to be announced';

  return (
    <article className={cn(
      'group relative overflow-hidden rounded-[22px] border bg-card shadow-[0_8px_30px_rgb(var(--theme-shadow-color)/5%)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_38px_rgb(var(--theme-shadow-color)/9%)]',
      compact ? 'p-3.5 sm:p-4' : 'p-4 sm:p-5',
      hasConflict ? 'border-destructive/45' : 'border-border',
    )}>
      <span aria-hidden="true" className="absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: subject.color }} />
      <div className="flex items-start gap-4">
        <div className="w-[54px] shrink-0 pt-0.5">
          <div className="text-[17px] font-semibold tracking-[-0.03em] text-foreground">{lesson.startTime}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{lesson.endTime}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full border-0 bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-secondary-foreground">
              {lesson.type === 'lecture' ? 'Lecture' : `Group ${lesson.group}`}
            </Badge>
            {hasConflict && (
              <Badge className="rounded-full border-0 bg-destructive-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-destructive-foreground">
                <AlertTriangle className="size-3" /> Conflict
              </Badge>
            )}
          </div>
          <h3 className="mt-2.5 max-w-2xl text-[16px] font-semibold leading-[1.35] tracking-[-0.025em] text-foreground sm:text-[17px]">{subject.name}</h3>
          <div className={cn('flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground sm:text-[13px]', compact ? 'mt-2' : 'mt-3')}>
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

function DaySection({ sourceLessons, sourceSubjects, day, date, week, subjectId, conflictIds, compact = false, cardCompact = false }: {
  sourceLessons: Lesson[]; sourceSubjects: Subject[]; day: WeekDay; date: Date; week: number;
  subjectId: string; conflictIds: Set<string>; compact?: boolean; cardCompact?: boolean;
}) {
  const dayLessons = getLessonsForDay(sourceLessons, week, day, subjectId);
  if (!dayLessons.length && compact) return null;

  return (
    <section className="scroll-mt-28" id={day}>
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-foreground">{dayLabels[day]}</h2>
          <span className="text-sm font-medium text-muted-foreground">{date.getDate()} {monthNames[date.getMonth()]}</span>
        </div>
        {dayLessons.length > 0 && <span className="text-xs font-medium text-muted-foreground">{dayLessons.length} {dayLessons.length === 1 ? 'class' : 'classes'}</span>}
      </div>
      {dayLessons.length ? (
        <div className="space-y-3">
          {dayLessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              subject={sourceSubjects.find((item) => item.id === lesson.subjectId)!}
              hasConflict={conflictIds.has(lesson.id)}
              compact={cardCompact}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[22px] border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">Free day — no classes</div>
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
          <article key={subject.id} className="relative overflow-hidden rounded-[22px] border border-border bg-card/75 p-5 shadow-[0_8px_30px_rgb(var(--theme-shadow-color)/4%)]">
            <span className="absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: subject.color }} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{subject.externalCode ?? 'No code'}</div>
                <h2 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.025em] text-foreground">{subject.name}</h2>
              </div>
              {subject.selectedGroup !== undefined && (
                <Badge variant="secondary" className="shrink-0 rounded-full border-0 bg-secondary text-[10px]">Group {subject.selectedGroup}</Badge>
              )}
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              {subjectLessons.length ? `${subjectLessons.length} schedule rules` : 'Course without recurring classes'}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ScheduleApp() {
  const { preferences, hasPendingChanges } = usePreferences();
  useTheme(preferences.appearance);
  const {
    schedule, selectedUser, selectUser, selectedSemesterId, selectSemester, source, loading, error,
    refresh, remoteConfigured, lastSync, online,
  } = useSchedule();
  const { lessons, subjects, semester } = schedule;
  const currentWeek = getSemesterWeek(semester.startDate, semester.weeksCount);
  const currentDay = getCurrentWeekDay();
  const [week, setWeek] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('scheduler_selected_week_v1'));
      return preferences.schedule.initialWeek === 'last-opened' && Number.isInteger(stored) && stored >= 1 && stored <= semester.weeksCount ? stored : currentWeek;
    } catch {
      return currentWeek;
    }
  });
  const [view, setView] = useState<ViewMode>(preferences.schedule.defaultView);
  const [subjectId, setSubjectIdState] = useState(() => {
    if (!preferences.schedule.rememberSubjectFilter) return 'all';
    try { return localStorage.getItem('scheduler_subject_filter_v1') ?? 'all'; } catch { return 'all'; }
  });

  const setSubjectId = (value: string) => {
    setSubjectIdState(value);
    try {
      if (preferences.schedule.rememberSubjectFilter) localStorage.setItem('scheduler_subject_filter_v1', value);
      else localStorage.removeItem('scheduler_subject_filter_v1');
    } catch { /* preference only */ }
  };

  const chooseWeek = (value: number) => {
    setWeek(value);
    try { localStorage.setItem('scheduler_selected_week_v1', String(value)); } catch { /* preference only */ }
  };

  useEffect(() => {
    setWeek(getSemesterWeek(semester.startDate, semester.weeksCount));
    setSubjectIdState('all');
  }, [semester.id, semester.startDate, semester.weeksCount]);

  const dates = useMemo(() => getWeekDates(semester.startDate, week), [semester.startDate, week]);
  const conflictIds = useMemo(() => preferences.schedule.highlightConflicts ? getConflictIds(lessons, week) : new Set<string>(), [lessons, week, preferences.schedule.highlightConflicts]);
  const activeLessons = useMemo(() => lessons.filter((lesson) => lesson.weeks.includes(week) && (subjectId === 'all' || lesson.subjectId === subjectId)), [lessons, week, subjectId]);
  const conflictCount = activeLessons.filter((lesson) => conflictIds.has(lesson.id)).length;
  const selectedUserName = schedule.users.find((user) => user.slug === selectedUser)?.displayName ?? schedule.user.displayName;
  const selectedSubjectName = subjectId === 'all'
    ? 'All courses'
    : (subjects.find((subject) => subject.id === subjectId)?.shortName ?? 'All courses');
  const visibleDays = view === 'today' ? (currentDay ? [currentDay] : []) : dayOrder.filter((day) => day !== 'saturday' || preferences.schedule.showSaturday || activeLessons.some((lesson) => lesson.day === 'saturday'));
  const visibleLessonCount = view === 'today' && currentDay
    ? activeLessons.filter((lesson) => lesson.day === currentDay).length
    : activeLessons.length;
  const dataSyncStatus = getScheduleSyncStatus({
    online,
    remoteConfigured,
    source,
    lastSync,
    backendError: error,
    hasPendingChanges,
  });

  const goToToday = () => {
    chooseWeek(currentWeek);
    setView('today');
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-20 -top-28 size-[380px] rounded-full bg-glow-a/45 blur-3xl" />
        <div className="absolute -left-32 top-[38%] size-[340px] rounded-full bg-glow-b/45 blur-3xl" />
      </div>

      <header className="relative border-b border-border/80 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7 lg:px-10 xl:py-5">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-[14px] bg-primary text-primary-foreground shadow-sm"><CalendarDays className="size-[19px]" strokeWidth={1.8} /></div>
            <div>
              <div className="text-[15px] font-bold tracking-[-0.02em] text-foreground">My Schedule</div>
              <div className="text-[11px] font-medium text-muted-foreground">{semester.title}</div>
            </div>
          </div>

          <div className="order-3 flex flex-1 flex-wrap gap-2 sm:order-none sm:flex-initial">
          <SemesterSelect schedule={schedule} value={selectedSemesterId} onChange={selectSemester} className="flex-1 sm:max-w-[230px]" />
          <Select
            value={selectedUser}
            onValueChange={(value) => {
              if (value) {
                setSubjectId('all');
                selectUser(value);
              }}
            }
          >
            <SelectTrigger aria-label="Schedule user" className="order-3 h-10 min-w-[170px] flex-1 rounded-full border-border bg-card/80 px-3.5 text-xs font-semibold text-foreground shadow-none sm:order-none sm:max-w-[220px] xl:h-11 xl:max-w-[240px] xl:text-sm">
              <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">{selectedUserName}</span>
            </SelectTrigger>
            <SelectContent align="start" sideOffset={7} className="min-w-[260px] rounded-[17px] border border-border bg-popover p-1.5 shadow-[0_18px_50px_rgb(var(--theme-shadow-color)/16%)]">
              {schedule.users.map((user) => <SelectItem key={user.id} value={user.slug} className="min-h-10 rounded-xl px-3 text-sm focus:bg-muted">{user.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
          </div>

          <nav className="hidden items-center rounded-full border border-border bg-card/70 p-1 md:flex" aria-label="Schedule view">
            {([['today', 'Today'], ['week', 'Week'], ['subjects', 'Courses']] as const).map(([value, label]) => (
              <button key={value} onClick={() => setView(value)} className={cn(
                'rounded-full px-4 py-2 text-xs font-semibold transition xl:px-5 xl:py-2.5 xl:text-sm',
                view === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}>{label}</button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <AdminLink user={schedule.users.find((user) => user.slug === selectedUser)} />
            <a href="#/import" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border bg-card/80 px-3.5 text-xs font-semibold text-foreground transition hover:bg-card xl:h-11 xl:px-4 xl:text-sm">
              <FileJson2 className="size-3.5" />
              <span className="hidden sm:inline">Import</span>
            </a>
            <a href="#/changes" className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card/80 text-foreground transition hover:bg-card xl:h-11 xl:w-auto xl:gap-1.5 xl:px-4 xl:text-sm xl:font-semibold"><History className="size-4" /><span className="hidden xl:inline">Changes</span></a>
            <a href="#/settings" className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-card/80 text-foreground transition hover:bg-card xl:h-11 xl:w-auto xl:gap-1.5 xl:px-4 xl:text-sm xl:font-semibold"><Settings2 className="size-4" /><span className="hidden xl:inline">Settings</span></a>
            <Button variant="outline" onClick={goToToday} className="h-10 rounded-full border-border bg-card/80 px-4 text-xs font-semibold text-foreground shadow-none hover:bg-card xl:h-11 xl:px-5 xl:text-sm">
              <Sparkles className="size-3.5 text-accent" />
              <span className="hidden xl:inline">Go to today</span>
              <span className="xl:hidden">Today</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1360px] px-4 pb-24 pt-6 sm:px-7 sm:pt-8 lg:px-10">
        <section className="rounded-[26px] border border-border bg-card/70 p-4 shadow-[0_16px_55px_rgb(var(--theme-shadow-color)/5%)] backdrop-blur-sm sm:p-5 xl:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button aria-label="Previous week" variant="outline" size="icon-lg" disabled={week === 1} onClick={() => chooseWeek(Math.max(1, week - 1))} className="rounded-full border-border bg-card shadow-none"><ArrowLeft /></Button>
              <div className="min-w-[132px] text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Academic</div>
                <div className="mt-0.5 text-xl font-semibold tracking-[-0.04em] text-foreground">Week {week}</div>
              </div>
              <Button aria-label="Next week" variant="outline" size="icon-lg" disabled={week === semester.weeksCount} onClick={() => chooseWeek(Math.min(semester.weeksCount, week + 1))} className="rounded-full border-border bg-card shadow-none"><ArrowRight /></Button>
            </div>

            <Select value={subjectId} onValueChange={(value) => value && setSubjectId(value)}>
              <SelectTrigger aria-label="Course filter" className="h-10 min-w-[230px] flex-1 rounded-full border-border bg-card px-4 text-xs font-semibold text-foreground shadow-none sm:max-w-[320px] xl:h-11 xl:max-w-[360px] xl:text-sm">
                <BookOpenText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">{selectedSubjectName}</span>
              </SelectTrigger>
              <SelectContent align="end" sideOffset={7} className="min-w-[min(440px,calc(100vw-24px))] rounded-[17px] border border-border bg-popover p-1.5 shadow-[0_18px_50px_rgb(var(--theme-shadow-color)/16%)]">
                <SelectItem value="all" className="min-h-10 rounded-xl px-3 text-sm font-semibold focus:bg-muted">All courses</SelectItem>
                {subjects.map((subject) => <SelectItem key={subject.id} value={subject.id} className="min-h-10 whitespace-normal rounded-xl px-3 py-2 text-sm leading-5 focus:bg-muted">{subject.shortName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
            {Array.from({ length: semester.weeksCount }, (_, index) => index + 1).map((value) => (
              <button key={value} aria-label={`Week ${value}`} aria-current={week === value ? 'true' : undefined} onClick={() => { chooseWeek(value); if (view === 'today') setView('week'); }} className={cn(
                'h-9 rounded-[12px] text-xs font-semibold transition sm:h-10',
                week === value ? 'bg-accent text-accent-foreground shadow-[0_6px_16px_rgb(var(--theme-shadow-color)/18%)]' : 'bg-secondary text-muted-foreground hover:bg-muted hover:text-foreground',
              )}>{value}</button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <output className="flex items-center gap-1.5" aria-live="polite">
              {dataSyncStatus.kind === 'current'
                ? <Sparkles className="size-3.5 text-success" />
                : dataSyncStatus.kind === 'pending'
                  ? <AlertTriangle className="size-3.5 text-warning" />
                  : <CloudOff className="size-3.5 text-warning" />}
              {dataSyncStatus.label} · revision {schedule.revision}
            </output>
            <Button variant="ghost" size="xs" disabled={loading || !remoteConfigured || !online} onClick={refresh} className="rounded-full px-2.5">
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Refresh
            </Button>
          </div>
          {error && <div className="mt-3 rounded-[12px] bg-destructive-soft px-3 py-2 text-xs text-destructive-foreground">{error}</div>}
        </section>

        <nav className="sticky top-3 z-20 mt-4 flex gap-2 overflow-x-auto rounded-[18px] border border-border bg-background/90 p-2 shadow-sm backdrop-blur-xl md:hidden" aria-label="Weekdays">
          {visibleDays.map((day) => (
            <a key={day} href={`#${day}`} className="flex min-w-[48px] flex-1 flex-col items-center rounded-[12px] px-2 py-2 text-xs font-semibold text-muted-foreground hover:bg-card hover:text-foreground">
              {dayLabelsShort[day]}<span className="mt-0.5 text-[10px] font-medium text-muted-foreground">{dates[day].getDate()}</span>
            </a>
          ))}
        </nav>

        <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{view === 'today' ? 'Today' : view === 'subjects' ? 'By course' : 'Week overview'}</p>
                <h1 className="mt-1.5 text-3xl font-semibold tracking-[-0.055em] text-foreground sm:text-[38px]">
                  {view === 'subjects' ? `${subjects.length} courses` : `${visibleLessonCount} classes`}
                </h1>
              </div>
              <div className="text-right text-xs leading-relaxed text-muted-foreground">{dates.monday.getDate()} {monthNames[dates.monday.getMonth()]} — {dates.saturday.getDate()} {monthNames[dates.saturday.getMonth()]}</div>
            </div>

            {loading && subjects.length === 0 ? (
              <div className="rounded-[24px] border border-border bg-card/70 px-6 py-12 text-center">
                <RefreshCw className="mx-auto size-5 animate-spin text-accent" />
                <div className="mt-3 text-sm font-semibold text-foreground">Loading schedule</div>
                <div className="mt-1 text-xs text-muted-foreground">User: {selectedUserName}</div>
              </div>
            ) : <div className="space-y-8">
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
                  compact={!preferences.schedule.showEmptyDays}
                  cardCompact={preferences.schedule.density === 'compact'}
                />
              ))}
              {view !== 'subjects' && (visibleDays.length === 0 || (!preferences.schedule.showEmptyDays && visibleLessonCount === 0)) && (
                <div className="rounded-[24px] border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
                  No classes today
                </div>
              )}
            </div>}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="overflow-hidden rounded-[24px] bg-primary p-5 text-primary-foreground shadow-[0_18px_45px_rgb(var(--theme-shadow-color)/15%)]">
              <div className="flex items-start justify-between gap-4">
                <div><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary-foreground/50">This week</div><div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{activeLessons.length} classes</div></div>
                <div className="grid size-10 place-items-center rounded-[13px] bg-primary-foreground/10"><Clock3 className="size-[18px] text-accent" /></div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-primary-foreground/10 pt-4">
                <div><div className="text-[10px] font-medium text-primary-foreground/45">Online</div><div className="mt-1 text-lg font-semibold">{activeLessons.filter((item) => item.format === 'online').length}</div></div>
                <div><div className="text-[10px] font-medium text-primary-foreground/45">On campus</div><div className="mt-1 text-lg font-semibold">{activeLessons.filter((item) => item.format !== 'online').length}</div></div>
              </div>
            </div>

            <div className={cn('rounded-[24px] border p-5', !preferences.schedule.highlightConflicts ? 'border-info/30 bg-info-soft' : conflictCount ? 'border-destructive/35 bg-destructive-soft' : 'border-success/30 bg-success-soft')}>
              <div className="flex gap-3">
                <div className={cn('grid size-9 shrink-0 place-items-center rounded-full', !preferences.schedule.highlightConflicts ? 'bg-info/15 text-info' : conflictCount ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success')}>
                  {preferences.schedule.highlightConflicts && conflictCount ? <AlertTriangle className="size-4" /> : <Sparkles className="size-4" />}
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-[-0.02em] text-foreground">{!preferences.schedule.highlightConflicts ? 'Highlighting disabled' : conflictCount ? 'Schedule conflicts found' : 'All clear'}</h2>
                  <p className={cn('mt-1 text-xs leading-relaxed', !preferences.schedule.highlightConflicts ? 'text-info-foreground' : conflictCount ? 'text-destructive-foreground' : 'text-success-foreground')}>{!preferences.schedule.highlightConflicts ? 'Enable conflict detection in settings.' : conflictCount ? `${conflictCount} classes overlap. They are marked in the schedule.` : 'No classes overlap this week.'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-border bg-card/60 p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Legend</div>
              <div className="mt-4 space-y-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2.5"><Laptop className="size-4" /> Online class</div>
                <div className="flex items-center gap-2.5"><MapPin className="size-4" /> On-campus class</div>
                <div className="flex items-center gap-2.5"><Radio className="size-4" /> Hybrid format</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-[20px] border border-border bg-background/92 p-1.5 shadow-[0_14px_38px_rgb(var(--theme-shadow-color)/14%)] backdrop-blur-xl md:hidden" aria-label="Main navigation">
        {([['today', 'Today'], ['week', 'Week'], ['subjects', 'Courses']] as const).map(([value, label]) => <button key={value} onClick={() => value === 'today' ? goToToday() : setView(value)} className={cn('rounded-[14px] px-2 py-2.5 text-[11px] font-semibold', view === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{label}</button>)}
        <a href="#/changes" className="flex items-center justify-center rounded-[14px] px-1 py-2.5 text-[11px] font-semibold text-muted-foreground">Changes</a>
        <a href="#/settings" className="flex items-center justify-center rounded-[14px] px-2 py-2.5 text-[11px] font-semibold text-muted-foreground">Settings</a>
      </nav>
    </main>
  );
}
