import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AdminMutationResponse, AdminUser } from '@/lib/admin/types';
import type { UserRole } from '@/lib/schedule/types';

export type UserDialog =
  | { kind: 'create'; revision: number }
  | { kind: 'edit' | 'active' | 'rotate'; revision: number; user: AdminUser };
export type UserFormValues = {
  displayName: string;
  slug: string;
  role: UserRole;
  rotateToken: boolean;
};

export function UserDialogForm({
  action,
  actorId,
  lastAdmin,
  disabled,
  busy,
  error,
  close,
  submit,
}: {
  action: UserDialog;
  actorId: string;
  lastAdmin: boolean;
  disabled: boolean;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (
    values: UserFormValues,
  ) => Promise<AdminMutationResponse | undefined>;
}) {
  const user = action.kind === 'create' ? undefined : action.user;
  const [displayName, setName] = useState(user?.displayName ?? '');
  const [slug, setSlug] = useState('');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'user');
  const [rotateToken, setRotate] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const self = user?.id === actorId;
  const dangerous =
    action.kind === 'rotate' ||
    action.kind === 'active' ||
    role !== (user?.role ?? 'user');
  const blocked = Boolean(
    lastAdmin &&
    user?.active &&
    user.role === 'admin' &&
    ((action.kind === 'active' && user.active) ||
      (action.kind === 'edit' && role !== 'admin')),
  );
  const title =
    action.kind === 'create'
      ? 'Create user'
      : action.kind === 'edit'
        ? 'Edit user'
        : action.kind === 'rotate'
          ? 'Rotate edit token'
          : user?.active
            ? 'Deactivate user'
            : 'Reactivate user';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {user ? `${user.displayName} · ${user.slug} · ` : ''}Snapshot
            revision {action.revision}. Conflicts require refreshing and
            reviewing again.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (disabled || blocked || (dangerous && !confirmed)) return;
            const result = await submit({
              displayName,
              slug,
              role,
              rotateToken,
            });
            if (result) close();
          }}
        >
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive-soft p-3 text-sm text-destructive-foreground"
            >
              {error} Close this dialog and refresh to review the latest data.
            </p>
          )}
          {(action.kind === 'create' || action.kind === 'edit') && (
            <>
              <label
                htmlFor="admin-user-name"
                className="block text-sm font-medium"
              >
                Display name
                <Input
                  id="admin-user-name"
                  required
                  maxLength={120}
                  value={displayName}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1"
                />
              </label>
              {action.kind === 'create' ? (
                <label
                  htmlFor="admin-user-slug"
                  className="block text-sm font-medium"
                >
                  Slug (immutable)
                  <Input
                    id="admin-user-slug"
                    required
                    minLength={2}
                    maxLength={40}
                    pattern="[a-z0-9][a-z0-9-]*"
                    placeholder="alex-smith"
                    value={slug}
                    onChange={(event) =>
                      setSlug(event.target.value.toLowerCase())
                    }
                    className="mt-1"
                  />
                </label>
              ) : (
                <p className="break-all text-xs text-muted-foreground">
                  ID: {user?.id}
                  <br />
                  Slug: {user?.slug} (immutable)
                </p>
              )}
              <label
                htmlFor="admin-user-role"
                className="block text-sm font-medium"
              >
                Role
                <select
                  id="admin-user-role"
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value as UserRole);
                    setConfirmed(false);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3"
                >
                  <option value="user">User</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                User: own settings and enrollments. Editor: shared schedule
                imports. Admin: all users and system administration.
              </p>
            </>
          )}
          {action.kind === 'rotate' && (
            <p className="text-sm">
              The old token immediately stops working on every device. The new
              token is shown once.{' '}
              {self &&
                'Your current admin session will switch to the new token.'}
            </p>
          )}
          {action.kind === 'active' &&
            (user?.active ? (
              <p className="text-sm">
                This user will disappear from public selectors and their token
                will stop working. Schedule, preferences and history are
                preserved.
              </p>
            ) : (
              <label
                htmlFor="admin-rotate-reactivation"
                className="flex items-center gap-2 text-sm"
              >
                <input
                  id="admin-rotate-reactivation"
                  type="checkbox"
                  checked={rotateToken}
                  onChange={(event) => {
                    setRotate(event.target.checked);
                    setConfirmed(false);
                  }}
                />
                Generate a new token (recommended). Uncheck to restore the old
                token.
              </label>
            ))}
          {self &&
            (action.kind === 'active' ||
              (action.kind === 'edit' && role !== 'admin')) && (
              <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning-foreground">
                This is your account. You will lose admin access and this
                session will close.
              </p>
            )}
          {blocked && (
            <p role="alert" className="text-sm text-destructive">
              The last active admin cannot be deactivated or demoted. Create or
              promote another admin first.
            </p>
          )}
          {dangerous && (
            <label
              htmlFor="admin-confirm"
              className="flex items-center gap-2 text-sm"
            >
              <input
                id="admin-confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I understand and confirm this change.
            </label>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={disabled || blocked || (dangerous && !confirmed)}
            >
              {busy ? 'Please wait…' : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TokenDialog({
  credential,
  dismiss,
}: {
  credential: { displayName: string; token: string };
  dismiss: () => void;
}) {
  const [copied, setCopied] = useState('');
  return (
    <Dialog
      open
      onOpenChange={() => {
        /* Explicit acknowledgement is required. */
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save {credential.displayName}’s token</DialogTitle>
          <DialogDescription>
            Shown only once. Store it securely and share only with its owner. It
            will not appear in the audit log or the user profile.
          </DialogDescription>
        </DialogHeader>
        <code className="select-all break-all rounded-xl bg-secondary p-3 text-sm">
          {credential.token}
        </code>
        <p className="text-xs text-muted-foreground">
          Leaving or refreshing this page discards this token. If lost, rotate
          it again.
        </p>
        <output className="text-xs" aria-live="polite">
          {copied}
        </output>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(credential.token);
                setCopied('Copied.');
              } catch {
                setCopied(
                  'Clipboard unavailable. Select the token and copy manually.',
                );
              }
            }}
          >
            Copy token
          </Button>
          <Button onClick={dismiss}>I saved the token</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
