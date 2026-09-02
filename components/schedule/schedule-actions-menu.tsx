import {
  Ellipsis,
  FileJson2,
  History,
  Link,
  Settings2,
  ShieldCheck,
} from 'lucide-react';

import { canShowAdminLink } from '@/components/admin/admin-link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ScheduleUser } from '@/lib/schedule/types';

const actions = [
  { href: '#/import', label: 'Import schedule', icon: FileJson2 },
  { href: '#/changes', label: 'Changes', icon: History },
  { href: '#/settings', label: 'Settings', icon: Settings2 },
] as const;

const itemClassName =
  'min-h-11 cursor-pointer gap-3 rounded-xl px-3 text-sm font-medium focus:bg-muted focus:text-foreground data-highlighted:bg-muted data-highlighted:text-foreground';

export function ScheduleActionsMenu({
  user,
  onCopyLink,
  copyDisabled = false,
}: {
  user?: ScheduleUser;
  onCopyLink?: () => void;
  copyDisabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="More actions"
        title="More actions"
        className="size-11 rounded-full text-muted-foreground hover:text-foreground"
      >
        <Ellipsis className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        aria-label="Schedule actions"
        className="w-56 max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-popover p-1.5 shadow-[0_16px_44px_rgb(var(--theme-shadow-color)/14%)] ring-0"
      >
        {onCopyLink && (
          <>
            <DropdownMenuItem
              onClick={onCopyLink}
              disabled={copyDisabled}
              className={itemClassName}
            >
              <Link className="size-4 text-muted-foreground" />
              Copy schedule link
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2 my-1" />
          </>
        )}
        {actions.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem
            key={href}
            render={<a href={href} aria-label={label} />}
            className={itemClassName}
          >
            <Icon className="size-4 text-muted-foreground" />
            {label}
          </DropdownMenuItem>
        ))}
        {canShowAdminLink(user) && (
          <>
            <DropdownMenuSeparator className="mx-2 my-1" />
            <DropdownMenuItem
              render={<a href="#/admin" aria-label="Admin panel" />}
              className={itemClassName}
            >
              <ShieldCheck className="size-4 text-muted-foreground" />
              Admin panel
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
