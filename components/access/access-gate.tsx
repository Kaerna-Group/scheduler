import { type ReactNode, type SyntheticEvent, useState } from 'react';
import { CalendarDays, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export const ACCESS_KEY = 'schedule_access_v1';
const PIN_HASH = '158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab';

async function hashPin(pin: string) {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function lockAccess() {
  try { localStorage.removeItem(ACCESS_KEY); } catch { /* storage may be unavailable */ }
  window.location.hash = '#/';
  window.location.reload();
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'locked' | 'unlocked'>(() => {
    try {
      return localStorage.getItem(ACCESS_KEY) === 'granted' ? 'unlocked' : 'locked';
    } catch {
      return 'locked';
    }
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function unlock(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pin.length !== 4 || busy) return;

    setBusy(true);
    setError('');

    try {
      if ((await hashPin(pin)) !== PIN_HASH) {
        setError('Невірний PIN. Спробуй ще раз.');
        setPin('');
        return;
      }

      localStorage.setItem(ACCESS_KEY, 'granted');
      setStatus('unlocked');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'unlocked') return children;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-10 text-foreground">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -right-16 -top-28 size-[380px] rounded-full bg-glow-a/65 blur-3xl" />
        <div className="absolute -bottom-24 -left-20 size-[360px] rounded-full bg-glow-b/70 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(var(--theme-grid)_1px,transparent_1px),linear-gradient(90deg,var(--theme-grid)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <section className="relative w-full max-w-[430px] overflow-hidden rounded-[30px] border border-border bg-card/85 p-6 shadow-[0_28px_90px_rgb(var(--theme-shadow-color)/13%)] backdrop-blur-xl sm:p-8">
        <div className="flex items-center justify-between">
          <div className="grid size-11 place-items-center rounded-[15px] bg-primary text-primary-foreground shadow-sm">
            <CalendarDays className="size-5" strokeWidth={1.8} />
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-success-foreground">
            <ShieldCheck className="size-3.5" /> Приватний доступ
          </div>
        </div>

        <div className="mt-9">
          <div className="mb-4 grid size-10 place-items-center rounded-full bg-warning-soft text-warning">
            <LockKeyhole className="size-[18px]" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-muted-foreground">Мій розклад</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.055em] text-foreground">Введи PIN-код</h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Чотири цифри — і розклад відкриється. На цьому пристрої повторно вводити код не доведеться.
          </p>
        </div>

          <form className="mt-8" onSubmit={unlock}>
            <InputOTP
              maxLength={4}
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(value) => {
                setPin(value.replace(/\D/g, '').slice(0, 4));
                if (error) setError('');
              }}
              containerClassName="justify-center"
              aria-label="Чотиризначний PIN-код"
            >
              <InputOTPGroup className="gap-2">
                {[0, 1, 2, 3].map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="size-14 rounded-[16px]! border border-input! bg-background text-xl font-semibold shadow-inner first:rounded-[16px]! last:rounded-[16px]! data-[active=true]:border-ring! data-[active=true]:ring-ring/25"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>

            <p className="mt-3 min-h-5 text-center text-xs font-medium text-destructive-foreground" aria-live="polite">{error}</p>

            <Button
              type="submit"
              disabled={pin.length !== 4 || busy}
              className="mt-2 h-12 w-full rounded-[16px] bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              <KeyRound className="size-4" />
              {busy ? 'Перевіряю…' : 'Відкрити розклад'}
            </Button>
          </form>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          Локальний захист від випадкових відвідувачів
        </p>
      </section>
    </main>
  );
}
