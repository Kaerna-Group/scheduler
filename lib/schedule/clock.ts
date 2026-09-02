// University wall-clock times, independent of the viewer's device time zone.
// Keep aligned with apps-script/appsscript.json until semesters have TZIDs.
export const SCHEDULE_TIME_ZONE = 'Europe/Kyiv';
export const DAY_MS = 86_400_000;

export function semesterMonday(startDate: string) {
  const start = new Date(startDate + 'T00:00:00.000Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !Number.isFinite(start.getTime()) ||
    start.toISOString().slice(0, 10) !== startDate
  ) {
    throw new Error(
      'The semester start date is invalid. Refresh the schedule before exporting.',
    );
  }
  // Week 1 is the Monday-based week containing startDate, also used by the UI.
  return start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY_MS;
}

export function clockMinutes(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error(
      'A lesson has an invalid time. Refresh the schedule before exporting.',
    );
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function scheduleDate(now: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULE_TIME_ZONE,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

export function createClockConverter() {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: SCHEDULE_TIME_ZONE,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new Error(
      `This browser cannot resolve ${SCHEDULE_TIME_ZONE}. Update your browser before exporting.`,
    );
  }
  function wallTime(instant: number) {
    const parts = formatter.formatToParts(instant);
    const part = (name: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === name)!.value;
    return new Date(
      `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}.000Z`,
    ).getTime();
  }
  const converted = new Map<number, number>();
  return (wall: number) => {
    const cached = converted.get(wall);
    if (cached !== undefined) return cached;
    // Sample both sides of a possible clock transition, then validate the exact
    // wall time. No hard-coded summer/winter offset or dependency on host TZ.
    const offsets = new Set(
      [-DAY_MS, 0, DAY_MS].map(
        (delta) => wallTime(wall + delta) - wall - delta,
      ),
    );
    const candidates = Array.from(offsets, (offset) => wall - offset)
      .filter((instant) => wallTime(instant) === wall)
      .sort((a, b) => a - b);
    if (!candidates.length)
      throw new Error(
        `A lesson falls in a clock-change gap in ${SCHEDULE_TIME_ZONE}. Correct its time before exporting.`,
      );
    // For repeated wall times, use the first occurrence, as RFC 5545 specifies.
    converted.set(wall, candidates[0]);
    return candidates[0];
  };
}
