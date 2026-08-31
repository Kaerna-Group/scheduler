import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { CalendarDays, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

const ACCESS_KEY = 'schedule_access_v1';
const PIN_HASH = '158a323a7ba44870f23d96f1516dd70aa48e9a72db4ebb026b0a89e212a208ab';

async function hashPin(pin: string) {
  const bytes = new TextEncoder().encode(pin);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setStatus(localStorage.getItem(ACCESS_KEY) === 'granted' ? 'unlocked' : 'locked');
    } catch {
      setStatus('locked');
    }
  }, []);

  async function unlock(event: FormEvent<HTMLFormElement>) {
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
        <div className="absolute -right-16 -top-28 size-[380px] rounded-full bg-[#e8d9ca]/65 blur-3xl" />
        <div className="absolute -bottom-24 -left-20 size-[360px] rounded-full bg-[#d8e7e4]/70 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(#aeb7b3_1px,transparent_1px),linear-gradient(90deg,#aeb7b3_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <section className="relative w-full max-w-[430px] overflow-hidden rounded-[30px] border border-[#dfdbd1] bg-white/85 p-6 shadow-[0_28px_90px_rgb(42_50_50/13%)] backdrop-blur-xl sm:p-8">
        <div className="flex items-center justify-between">
          <div className="grid size-11 place-items-center rounded-[15px] bg-[#293638] text-white shadow-sm">
            <CalendarDays className="size-5" strokeWidth={1.8} />
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-[#edf3ef] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#5d7669]">
            <ShieldCheck className="size-3.5" /> Приватний доступ
          </div>
        </div>

        <div className="mt-9">
          <div className="mb-4 grid size-10 place-items-center rounded-full bg-[#fff0e7] text-[#d87845]">
            <LockKeyhole className="size-[18px]" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#9a978e]">Мій розклад</p>
          <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.055em] text-[#273033]">Введи PIN-код</h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#767872]">
            Чотири цифри — і розклад відкриється. На цьому пристрої повторно вводити код не доведеться.
          </p>
        </div>

        {status === 'checking' ? (
          <div className="mt-8 flex h-[126px] items-center justify-center text-sm text-[#92938d]">Перевіряю доступ…</div>
        ) : (
          <form className="mt-8" onSubmit={unlock}>
            <InputOTP
              autoFocus
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
                    className="size-14 rounded-[16px]! border border-[#dcd8ce]! bg-[#f8f6f1] text-xl font-semibold shadow-inner first:rounded-[16px]! last:rounded-[16px]! data-[active=true]:border-[#df8a58]! data-[active=true]:ring-[#eda77e]/25"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>

            <p className="mt-3 min-h-5 text-center text-xs font-medium text-[#bd5f52]" aria-live="polite">{error}</p>

            <Button
              type="submit"
              disabled={pin.length !== 4 || busy}
              className="mt-2 h-12 w-full rounded-[16px] bg-[#293638] text-sm font-semibold text-white hover:bg-[#354648]"
            >
              <KeyRound className="size-4" />
              {busy ? 'Перевіряю…' : 'Відкрити розклад'}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-[#a09f98]">
          Локальний захист від випадкових відвідувачів
        </p>
      </section>
    </main>
  );
}
