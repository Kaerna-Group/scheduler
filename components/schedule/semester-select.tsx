import { Archive, CalendarRange } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import type { SemesterSummary, UserSchedule } from '@/lib/schedule/types';

function availableSemesters(schedule: UserSchedule): SemesterSummary[] {
  return schedule.semesters?.length
    ? schedule.semesters
    : [{ ...schedule.semester, archived: false, current: true }];
}

export function SemesterSelect({ schedule, value, onChange, className = '' }: {
  schedule: UserSchedule;
  value: string;
  onChange: (semesterId: string) => void;
  className?: string;
}) {
  const semesters = availableSemesters(schedule);
  const selected = semesters.find((semester) => semester.id === value) ?? semesters[0];
  return (
    <Select value={selected?.id} onValueChange={(semesterId) => semesterId && onChange(semesterId)}>
      <SelectTrigger aria-label="Semester" className={`h-10 min-w-[190px] rounded-full border-border bg-card/80 px-3.5 text-xs font-semibold shadow-none ${className}`}>
        <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">{selected?.title ?? schedule.semester.title}</span>
        {selected?.archived && <span className="text-[9px] uppercase text-muted-foreground">Archive</span>}
      </SelectTrigger>
      <SelectContent className="min-w-[280px]">
        {semesters.map((semester) => (
          <SelectItem key={semester.id} value={semester.id}>
            <span className="flex items-center gap-2">
              {semester.archived && <Archive className="size-3.5 text-muted-foreground" />}
              <span>{semester.title}</span>
              {semester.current && <span className="text-[10px] font-bold uppercase tracking-wide text-accent">Current</span>}
              {semester.archived && <span className="text-[10px] text-muted-foreground">Archive</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
