import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { LessonParticipants as Participants } from '@/lib/schedule/participants';
import type { ScheduleUser } from '@/lib/schedule/types';

const initialsSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

function UserAvatar({ user }: { user: ScheduleUser }) {
  const initials = user.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(
      (part) => Array.from(initialsSegmenter.segment(part))[0]?.segment ?? '',
    )
    .join('')
    .toLocaleUpperCase();
  return (
    <Avatar size="sm" className="ring-2 ring-card">
      <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
        {initials || '?'}
      </AvatarFallback>
    </Avatar>
  );
}

export function LessonParticipants({
  participants,
  ownerId,
}: {
  participants: Participants;
  ownerId: string;
}) {
  if (participants.users.length < 2) return null;
  return (
    <div className="mt-3 flex justify-end">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={150}
          closeDelay={150}
          aria-label={`${participants.users.length} people attending this class`}
          className="inline-flex min-h-9 items-center gap-2 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className="flex -space-x-1.5">
            {participants.users.slice(0, 3).map((user) => (
              <UserAvatar key={user.id} user={user} />
            ))}
            {participants.users.length > 3 && (
              <span className="grid size-6 place-items-center rounded-full bg-secondary text-[10px] font-semibold ring-2 ring-card">
                +{participants.users.length - 3}
              </span>
            )}
          </span>
          <span aria-hidden="true">{participants.users.length}</span>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="max-w-[calc(100vw-32px)] rounded-2xl p-4"
        >
          <PopoverTitle>Attending this class</PopoverTitle>
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {participants.users.map((user) => (
              <li key={user.id} className="flex items-center gap-2.5">
                <UserAvatar user={user} />
                <span className="min-w-0 flex-1 break-words text-sm">
                  {user.displayName}
                </span>
                {user.id === ownerId && (
                  <span className="text-[10px] text-muted-foreground">
                    This schedule
                  </span>
                )}
              </li>
            ))}
          </ul>
          {participants.cached && (
            <p className="text-xs text-muted-foreground">
              Saved schedules · participants may have changed.
            </p>
          )}
          {participants.incomplete && (
            <p className="text-xs text-muted-foreground">
              Some schedules have not been checked yet.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
