import { useEffect, useMemo, useState } from 'react';
import { navigateSchedule } from '@/hooks/use-app-location';
import { readPreferences } from '@/lib/preferences/local-storage';
import type { SchedulerPreferences } from '@/lib/preferences/types';
import { scheduleUrl } from '@/lib/schedule/location';
import type {
  ScheduleLinkState,
  ScheduleLocation,
  ScheduleView,
} from '@/lib/schedule/location';
import type { UserSchedule } from '@/lib/schedule/types';
import { getSemesterWeek } from '@/lib/schedule/utils';

export function useScheduleView(args: {
  href: string;
  route: ScheduleLocation | null;
  schedule: UserSchedule;
  selectedUser: string;
  selectedSemesterId: string;
  selectionReady: boolean;
  loading: boolean;
  error: string;
  preferences: SchedulerPreferences;
}) {
  const {
    href,
    route,
    schedule,
    selectedUser,
    selectedSemesterId,
    selectionReady,
    loading,
    error,
    preferences,
  } = args;
  const currentWeek = getSemesterWeek(
    schedule.semester.startDate,
    schedule.semester.weeksCount,
  );
  const [defaults] = useState(() => {
    const ownerPreferences = readPreferences(selectedUser);
    let week: number | undefined;
    let subject = 'all';
    try {
      const stored = Number(localStorage.getItem('scheduler_selected_week_v1'));
      if (
        ownerPreferences.schedule.initialWeek === 'last-opened' &&
        Number.isSafeInteger(stored) &&
        stored >= 1
      )
        week = stored;
      if (ownerPreferences.schedule.rememberSubjectFilter)
        subject = localStorage.getItem('scheduler_subject_filter_v1') || 'all';
    } catch {
      /* The URL and defaults still work without localStorage. */
    }
    return { week, subject, view: ownerPreferences.schedule.defaultView };
  });
  const view = route?.view ?? defaults.view;
  const requestedWeek =
    route?.week ??
    (route?.explicit ? currentWeek : (defaults.week ?? currentWeek));
  const week = Math.max(
    1,
    Math.min(schedule.semester.weeksCount, requestedWeek),
  );
  const requestedSubject =
    route?.subject ?? (route?.explicit ? 'all' : defaults.subject);
  const subject = schedule.subjects.find(
    (item) =>
      item.id === requestedSubject || item.externalCode === requestedSubject,
  );
  const subjectId =
    requestedSubject === 'all' ? 'all' : (subject?.id ?? requestedSubject);
  const subjectReference =
    subject?.externalCode && subject.externalCode !== 'all'
      ? subject.externalCode
      : (subject?.id ?? requestedSubject);
  const linkState = useMemo<ScheduleLinkState>(
    () => ({
      view,
      week,
      user: selectedUser,
      semester: selectedSemesterId,
      subject: subjectReference,
    }),
    [view, week, selectedUser, selectedSemesterId, subjectReference],
  );
  const link = scheduleUrl(href, linkState);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    // Never rewrite a target while its user/semester is still loading, or
    // replace an unavailable link with unrelated fallback data.
    if (
      !route ||
      !selectionReady ||
      loading ||
      error ||
      window.location.href !== href
    )
      return;
    const warnings = [...route.warnings];
    if (route.week !== undefined && week !== route.week)
      warnings.push(
        `Week ${route.week} is outside this semester; showing week ${week}.`,
      );
    if (warnings.length) setNotice(warnings.join(' '));
    try {
      localStorage.setItem('scheduler_selected_week_v1', String(week));
      if (preferences.schedule.rememberSubjectFilter)
        localStorage.setItem('scheduler_subject_filter_v1', subjectReference);
      else localStorage.removeItem('scheduler_subject_filter_v1');
    } catch {
      /* The URL remains the source of truth. */
    }
    navigateSchedule(link, true);
  }, [
    href,
    route,
    selectionReady,
    loading,
    error,
    link,
    week,
    subjectReference,
    preferences.schedule.rememberSubjectFilter,
  ]);

  function navigate(patch: Partial<ScheduleLinkState>) {
    setNotice('');
    navigateSchedule(scheduleUrl(href, { ...linkState, ...patch }));
  }
  const subjectReferenceFor = (id: string) => {
    const selected = schedule.subjects.find((item) => item.id === id);
    return selected?.externalCode && selected.externalCode !== 'all'
      ? selected.externalCode
      : id;
  };
  const setSubjectId = (id: string) =>
    navigate({ subject: subjectReferenceFor(id) });
  const courseLink = (id: string) =>
    scheduleUrl(href, {
      ...linkState,
      view: 'subjects',
      subject: subjectReferenceFor(id),
    });
  const selectUser = (user: string) => navigate({ user, subject: 'all' });
  const selectSemester = (semester: string) => {
    const target = schedule.semesters?.find((item) => item.id === semester);
    navigate({
      semester,
      week: target ? getSemesterWeek(target.startDate, target.weeksCount) : 1,
      subject: 'all',
    });
  };
  const chooseWeek = (value: number) =>
    navigate({ week: value, view: view === 'today' ? 'week' : view });
  const setView = (value: ScheduleView) =>
    navigate({
      view: value,
      ...(value === 'today' ? { week: currentWeek } : {}),
    });
  return {
    week,
    view,
    subjectId,
    chooseWeek,
    setView,
    setSubjectId,
    courseLink,
    selectUser,
    selectSemester,
    link,
    notice,
    missingSubject:
      selectionReady && !loading && requestedSubject !== 'all' && !subject,
    canShare: selectionReady && !loading,
  };
}
