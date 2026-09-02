import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { enrollmentDraft, enrollmentPayload } from '@/lib/admin/presentation';
import type { AdminUserDetails } from '@/lib/admin/types';

export function UserEnrollments({
  details,
  enabled,
  save,
}: {
  details: AdminUserDetails;
  enabled: boolean;
  save: (enrollments: ReturnType<typeof enrollmentPayload>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => enrollmentDraft(details));
  const [confirm, setConfirm] = useState(false);
  const writable = enabled && details.user.active && !details.semester.archived;
  const dirty =
    JSON.stringify(
      enrollmentPayload(draft).sort((a, b) =>
        a.externalCode.localeCompare(b.externalCode),
      ),
    ) !==
    JSON.stringify(
      enrollmentPayload(enrollmentDraft(details)).sort((a, b) =>
        a.externalCode.localeCompare(b.externalCode),
      ),
    );
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Enrollments · {details.semester.title}</h3>
      <p className="text-xs text-muted-foreground">
        Full semester catalog, not just this user’s courses. Unchecking a course
        removes only this user’s enrollment. Shared lessons remain unchanged.
      </p>
      {(!details.user.active || details.semester.archived) && (
        <p className="text-sm text-warning-foreground">
          Read-only:{' '}
          {details.semester.archived ? 'archived semester' : 'inactive user'}.
        </p>
      )}
      {!details.catalog.length && (
        <p className="text-sm text-muted-foreground">
          No courses in this semester yet.
        </p>
      )}
      <fieldset disabled={!writable} className="space-y-2">
        {details.catalog.map((course) => {
          const checked = Object.hasOwn(draft, course.externalCode);
          return (
            <div
              key={course.offeringId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <label
                htmlFor={`enrollment-${course.offeringId}`}
                className="flex min-w-0 items-center gap-3 text-sm"
              >
                <input
                  id={`enrollment-${course.offeringId}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setConfirm(false);
                    setDraft((previous) => {
                      const next = { ...previous };
                      if (event.target.checked)
                        next[course.externalCode] = null;
                      else delete next[course.externalCode];
                      return next;
                    });
                  }}
                />
                <span>
                  {course.subject.name}
                  <span className="block text-xs text-muted-foreground">
                    {course.externalCode}
                  </span>
                </span>
              </label>
              {checked && (
                <select
                  aria-label={`Group for ${course.subject.name}`}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
                  value={draft[course.externalCode] ?? ''}
                  onChange={(event) => {
                    setConfirm(false);
                    setDraft({
                      ...draft,
                      [course.externalCode]: event.target.value
                        ? Number(event.target.value)
                        : null,
                    });
                  }}
                >
                  <option value="">No group</option>
                  {course.availableGroups.map((group) => (
                    <option key={group} value={group}>
                      Group {group}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </fieldset>
      {dirty && writable && (
        <div className="rounded-xl bg-warning-soft p-3 text-sm">
          <p>
            {Object.keys(draft).length} courses selected. Saving replaces{' '}
            {details.user.displayName}’s enrollments for this semester at
            revision {details.revision}.
          </p>
          {confirm ? (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void save(enrollmentPayload(draft))}>
                Confirm enrollments
              </Button>
              <Button variant="outline" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button className="mt-3" onClick={() => setConfirm(true)}>
              Review and save
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
