import { Check, Clock3 } from 'lucide-react';

import type { ThemeDefinition } from '@/lib/theme/theme-registry';
import { cn } from '@/lib/utils';

export function ThemeCard({ theme, selected, onSelect }: { theme: ThemeDefinition; selected: boolean; onSelect: () => void }) {
  return (
    <label
      className={cn(
        'group cursor-pointer rounded-[20px] border p-3 text-left transition has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
        selected ? 'border-ring bg-accent/10' : 'border-border bg-card hover:border-ring/50',
      )}
    >
      <input type="radio" name="scheduler-theme" checked={selected} onChange={onSelect} className="sr-only" />
      <div
        className="overflow-hidden rounded-[14px] border p-2.5"
        style={{ background: theme.preview.background, borderColor: theme.preview.border, color: theme.preview.foreground }}
        aria-hidden="true"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="h-2 w-12 rounded-full" style={{ background: theme.preview.foreground, opacity: 0.75 }} />
          <div className="size-2.5 rounded-full" style={{ background: theme.preview.accent }} />
        </div>
        <div className="rounded-[9px] border p-2" style={{ background: theme.preview.surface, borderColor: theme.preview.border }}>
          <div className="flex gap-2">
            <div className="w-1 rounded-full" style={{ background: theme.preview.accent }} />
            <div className="min-w-0 flex-1">
              <div className="h-1.5 w-4/5 rounded-full" style={{ background: theme.preview.foreground, opacity: 0.82 }} />
              <div className="mt-1.5 flex items-center gap-1 opacity-55"><Clock3 className="size-2.5" /><div className="h-1 w-10 rounded-full" style={{ background: theme.preview.foreground }} /></div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3 px-0.5">
        <div><div className="text-sm font-semibold text-foreground">{theme.name}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{theme.description}</div></div>
        {selected && <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span>}
      </div>
    </label>
  );
}
