import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { auditSummary } from '@/lib/admin/presentation';
import type {
  AdminAuditEntry,
  AdminAuditFilters,
  AdminAuditResponse,
  AdminOverview,
} from '@/lib/admin/types';

export function AuditEntries({ entries }: { entries: AdminAuditEntry[] }) {
  if (!entries.length)
    return (
      <p className="py-4 text-sm text-muted-foreground">No changes found.</p>
    );
  return (
    <div className="divide-y divide-border">
      {entries.map((entry) => (
        <details key={entry.id} className="py-3">
          <summary className="cursor-pointer text-sm">
            <span className="font-medium">{auditSummary(entry)}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {entry.actorName} ·{' '}
              {entry.timestamp
                ? new Date(entry.timestamp).toLocaleString()
                : 'Unknown date'}{' '}
              · r{entry.revision}
            </span>
          </summary>
          <div className="mt-3 rounded-xl bg-secondary p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              {entry.entityId} · Sanitized raw data
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(
                { before: entry.oldValue, after: entry.newValue },
                null,
                2,
              )}
            </pre>
          </div>
        </details>
      ))}
    </div>
  );
}

export function AuditLog({
  overview,
  data,
  loading,
  online,
  load,
}: {
  overview: AdminOverview;
  data: AdminAuditResponse | null;
  loading: boolean;
  online: boolean;
  load: (filters: AdminAuditFilters) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AdminAuditFilters>({});
  const [filters, setFilters] = useState<AdminAuditFilters>({
    offset: 0,
    limit: 25,
  });
  useEffect(() => {
    void load(filters);
  }, [filters, load]);
  const selectClass =
    'mt-1 h-10 w-full rounded-lg border border-border bg-background px-2 text-sm';
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Audit log</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          All administrative and schedule changes, including inactive users.
          Dates use UTC.
        </p>
      </div>
      <form
        className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({ ...draft, offset: 0, limit: 25 });
        }}
      >
        <label htmlFor="audit-search" className="text-xs font-medium">
          Search
          <Input
            id="audit-search"
            className="mt-1"
            value={draft.search ?? ''}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          />
        </label>
        <label htmlFor="audit-actor" className="text-xs font-medium">
          Actor
          <select
            id="audit-actor"
            className={selectClass}
            value={draft.actorId ?? ''}
            onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
          >
            <option value="">All actors</option>
            <option value="SYSTEM">System</option>
            {overview.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
                {user.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="audit-action" className="text-xs font-medium">
          Action
          <select
            id="audit-action"
            className={selectClass}
            value={draft.action ?? ''}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          >
            <option value="">All actions</option>
            {overview.auditOptions.actions.map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
        </label>
        <label htmlFor="audit-entity" className="text-xs font-medium">
          Entity
          <select
            id="audit-entity"
            className={selectClass}
            value={draft.entityType ?? ''}
            onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
          >
            <option value="">All entities</option>
            {overview.auditOptions.entityTypes.map((entity) => (
              <option key={entity}>{entity}</option>
            ))}
          </select>
        </label>
        <label htmlFor="audit-from" className="text-xs font-medium">
          From (UTC)
          <Input
            id="audit-from"
            type="date"
            className="mt-1"
            value={draft.from ?? ''}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label htmlFor="audit-to" className="text-xs font-medium">
          Through (UTC)
          <Input
            id="audit-to"
            type="date"
            min={draft.from}
            className="mt-1"
            value={draft.to ?? ''}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <Button type="submit" disabled={loading || !online}>
          Apply filters / refresh
        </Button>
      </form>
      <div
        className="rounded-2xl border border-border bg-card p-4"
        aria-busy={loading}
      >
        {loading ? (
          <output>Loading audit…</output>
        ) : (
          data && (
            <>
              <p className="text-xs text-muted-foreground">
                {data.total} entries · snapshot r{data.revision}
              </p>
              <AuditEntries entries={data.entries} />
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={!online || data.offset === 0}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      offset: Math.max(0, data.offset - data.limit),
                    })
                  }
                >
                  Previous
                </Button>
                <span className="text-xs">
                  {data.total ? data.offset + 1 : 0}–
                  {Math.min(data.offset + data.entries.length, data.total)} /{' '}
                  {data.total}
                </span>
                <Button
                  variant="outline"
                  disabled={!online || data.offset + data.limit >= data.total}
                  onClick={() =>
                    setFilters({ ...filters, offset: data.offset + data.limit })
                  }
                >
                  Next
                </Button>
              </div>
            </>
          )
        )}
      </div>
    </section>
  );
}
