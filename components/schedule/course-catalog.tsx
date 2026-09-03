import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getCourseOccurrences } from '@/lib/schedule/course-occurrences';
import type { Lesson, Semester, Subject } from '@/lib/schedule/types';

export function CourseCatalog({
  subjects,
  lessons,
  semester,
  courseLink,
}: {
  subjects: Subject[];
  lessons: Lesson[];
  semester: Semester;
  courseLink: (id: string) => string;
}) {
  if (!subjects.length)
    return (
      <p className="rounded-[22px] border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
        No courses in this schedule for this semester.
      </p>
    );

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {subjects.map((subject) => {
        const count = getCourseOccurrences(lessons, semester, subject).length;
        return (
          <a
            key={subject.id}
            href={courseLink(subject.id)}
            aria-label={`View ${subject.name}`}
            className="group relative overflow-hidden rounded-[22px] border border-border bg-card/75 p-5 shadow-[0_8px_30px_rgb(var(--theme-shadow-color)/4%)] transition hover:border-primary/40 hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-5 left-0 w-[3px] rounded-r-full"
              style={{ backgroundColor: subject.color }}
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 break-words">
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {subject.externalCode ?? 'No code'}
                </div>
                <h2 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.025em] text-foreground">
                  {subject.name}
                </h2>
              </div>
              {subject.selectedGroup !== undefined && (
                <Badge
                  variant="secondary"
                  className="shrink-0 rounded-full border-0 bg-secondary text-[10px]"
                >
                  Group {subject.selectedGroup}
                </Badge>
              )}
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              {count
                ? `${count} ${count === 1 ? 'class' : 'classes'} this semester`
                : 'No classes scheduled this semester'}
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-foreground">
              View all classes{' '}
              <ArrowRight
                aria-hidden="true"
                className="size-3.5 transition-transform group-hover:translate-x-1"
              />
            </div>
          </a>
        );
      })}
    </div>
  );
}
