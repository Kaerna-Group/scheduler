import { ShieldCheck } from 'lucide-react';
import { getStoredEditToken } from '@/lib/schedule/repository';
import type { ScheduleUser } from '@/lib/schedule/types';

// Visibility is only a convenience. The admin page always authenticates on the server.
export function AdminLink({ user }: { user?: ScheduleUser }) {
  if (user?.role !== 'admin' || !getStoredEditToken(user.slug)) return null;
  return (
    <a
      href="#/admin"
      className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs font-semibold hover:bg-secondary"
    >
      <ShieldCheck className="size-3.5" />
      Admin
    </a>
  );
}
