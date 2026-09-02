import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AuditEntries } from './audit-log';
import { UserEnrollments } from './user-enrollments';
import {
  UserDialogForm,
  type UserDialog,
  type UserFormValues,
} from './user-dialogs';
import type { useAdmin } from '@/hooks/use-admin';
import type { AdminOverview } from '@/lib/admin/types';
import {
  createAdminUser,
  rotateAdminUserToken,
  setAdminUserActive,
  updateAdminUser,
} from '@/lib/admin/repository';
import { updateEnrollments } from '@/lib/schedule/repository';

export function UsersPanel({
  admin,
  overview,
}: {
  admin: ReturnType<typeof useAdmin>;
  overview: AdminOverview;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [semesterId, setSemesterId] = useState(overview.semester?.id ?? '');
  const [action, setAction] = useState<UserDialog | null>(null);
  const [notice, setNotice] = useState('');
  const details = admin.details;
  const enabled = admin.online && !admin.saving && !admin.credential;
  const users = overview.users.filter(
    (user) =>
      (status === 'all' || user.active === (status === 'active')) &&
      `${user.displayName} ${user.slug} ${user.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const lastAdmin =
    overview.users.filter((user) => user.active && user.role === 'admin')
      .length <= 1;
  async function submit(values: UserFormValues) {
    if (!action) return;
    const result = await admin.mutate((token) =>
      action.kind === 'create'
        ? createAdminUser(token, action.revision, values)
        : action.kind === 'edit'
          ? updateAdminUser(token, action.revision, action.user.id, {
              displayName: values.displayName,
              role: values.role,
            })
          : action.kind === 'active'
            ? setAdminUserActive(
                token,
                action.revision,
                action.user.id,
                !action.user.active,
                values.rotateToken,
              )
            : rotateAdminUserToken(token, action.revision, action.user.id),
    );
    if (
      result &&
      !(
        result.user.id === overview.actor.id &&
        (!result.user.active || result.user.role !== 'admin')
      )
    ) {
      setNotice('User updated.');
      void admin.loadUser(result.user.id, semesterId);
    }
    return result;
  }
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage access, preferences visibility and course enrollments.
          </p>
        </div>
        <Button
          disabled={!enabled}
          onClick={() =>
            setAction({ kind: 'create', revision: overview.revision })
          }
        >
          Create user
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          aria-label="Search users"
          placeholder="Search name or slug"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="sm:max-w-xs"
        />
        <select
          aria-label="User status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All users</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-xs">
            <tr>
              {[
                'User',
                'Role',
                'Status',
                'Courses (current)',
                'Preferences revision',
                '',
              ].map((label, index) => (
                <th key={index} scope="col" className="p-3">
                  {label || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-border">
                <td className="p-3 font-medium">
                  {user.displayName}
                  {user.id === overview.actor.id && (
                    <span className="ml-2 text-xs text-accent">You</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {user.slug}
                  </span>
                </td>
                <td className="p-3">{user.role}</td>
                <td className="p-3">{user.active ? 'Active' : 'Inactive'}</td>
                <td className="p-3">{user.enrollmentCount}</td>
                <td className="p-3">{user.preferencesRevision ?? 'Missing'}</td>
                <td className="p-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!enabled || admin.detailLoading}
                    onClick={() => {
                      setNotice('');
                      void admin.loadUser(user.id, semesterId);
                    }}
                  >
                    Manage<span className="sr-only"> {user.displayName}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && (
          <p className="p-4 text-sm text-muted-foreground">No users found.</p>
        )}
      </div>
      <output className="block text-sm" aria-live="polite">
        {notice}
      </output>
      {admin.detailLoading && <output>Loading user…</output>}
      {details && (
        <article className="space-y-6 rounded-2xl border border-border bg-card p-4 sm:p-6">
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">
                {details.user.displayName}
              </h3>
              <p className="break-all text-xs text-muted-foreground">
                {details.user.id} · {details.user.slug} · {details.user.role} ·{' '}
                {details.user.active ? 'Active' : 'Inactive'} · snapshot r
                {details.revision}
              </p>
            </div>
            {details.revision !== overview.revision && (
              <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning-foreground">
                Newer data is available. Your draft is kept at r
                {details.revision}. Reload the profile to discard the draft and
                review r{overview.revision}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!enabled}
                onClick={() => void admin.loadUser(details.user.id, semesterId)}
              >
                Reload profile
              </Button>
              <Button
                variant="outline"
                disabled={!enabled}
                onClick={() =>
                  setAction({
                    kind: 'edit',
                    user: details.user,
                    revision: details.revision,
                  })
                }
              >
                Edit name / role
              </Button>
              <Button
                variant="outline"
                disabled={!enabled}
                onClick={() =>
                  setAction({
                    kind: 'rotate',
                    user: details.user,
                    revision: details.revision,
                  })
                }
              >
                Rotate token
              </Button>
              <Button
                variant="outline"
                disabled={
                  !enabled ||
                  (lastAdmin &&
                    details.user.active &&
                    details.user.role === 'admin')
                }
                onClick={() =>
                  setAction({
                    kind: 'active',
                    user: details.user,
                    revision: details.revision,
                  })
                }
              >
                {details.user.active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
            {lastAdmin &&
              details.user.active &&
              details.user.role === 'admin' && (
                <p className="text-xs text-muted-foreground">
                  Last active admin: deactivation and demotion are protected.
                </p>
              )}
          </div>
          <label htmlFor="admin-semester" className="block text-sm font-medium">
            Enrollment semester
            <select
              id="admin-semester"
              value={details.semester.id}
              disabled={!enabled}
              onChange={(event) => {
                setSemesterId(event.target.value);
                void admin.loadUser(details.user.id, event.target.value);
              }}
              className="ml-3 max-w-full rounded-lg border border-border bg-background p-2"
            >
              {overview.semesters.map((semester) => (
                <option key={semester.id} value={semester.id}>
                  {semester.title}
                  {semester.archived ? ' (archived)' : ''}
                </option>
              ))}
            </select>
          </label>
          <UserEnrollments
            key={`${details.user.id}:${details.semester.id}:${details.revision}`}
            details={details}
            enabled={enabled}
            save={async (enrollments) => {
              const result = await admin.mutate((token) =>
                updateEnrollments({
                  userSlug: details.user.slug,
                  token,
                  semesterId: details.semester.id,
                  baseRevision: details.revision,
                  signal: AbortSignal.timeout(45000),
                  enrollments,
                }),
              );
              if (result) {
                setNotice('Enrollments saved.');
                void admin.loadUser(details.user.id, details.semester.id);
              }
            }}
          />
          <section>
            <h3 className="font-semibold">Preferences (read-only)</h3>
            <p className="my-2 text-xs text-muted-foreground">
              Independent revision:{' '}
              {details.user.preferencesRevision ?? 'missing'}. Preferences are
              changed by their owner in Settings.
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-secondary p-3 text-xs">
              {details.preferences
                ? JSON.stringify(details.preferences, null, 2)
                : 'No preference row. Check System diagnostics.'}
            </pre>
          </section>
          <section>
            <h3 className="font-semibold">Recent actions by this user</h3>
            <AuditEntries entries={details.recentAudit} />
          </section>
        </article>
      )}
      {action && (
        <UserDialogForm
          action={action}
          actorId={overview.actor.id}
          lastAdmin={lastAdmin}
          disabled={!enabled}
          busy={admin.saving}
          error={admin.error}
          close={() => setAction(null)}
          submit={submit}
        />
      )}
    </section>
  );
}
