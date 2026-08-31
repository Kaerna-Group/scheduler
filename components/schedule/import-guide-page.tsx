import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, CheckCircle2, Clipboard, Download, FileJson2,
  KeyRound, RefreshCw, ShieldAlert, Upload, UserRound,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useSchedule } from '@/hooks/use-schedule';
import { buildLlmImportPrompt, scheduleImportExample } from '@/lib/schedule/import-guide';
import { exportSchedule, validateScheduleImport } from '@/lib/schedule/import';
import { getStoredEditToken, importPersonalSchedule, storeEditToken } from '@/lib/schedule/repository';

const rules = [
  ['Формат відповіді', 'Лише чистий JSON. Без Markdown-блоків, коментарів, пояснень і зайвого тексту.'],
  ['Корінь документа', 'Об’єкт із schemaVersion: 1, точним semesterId та масивом subjects.'],
  ['Код дисципліни', 'externalCode обов’язковий, стабільний та унікальний у файлі. Однаковий код означає спільну дисципліну для всіх користувачів.'],
  ['Якщо коду немає', 'Використай стабільний LOCAL-LATIN-SLUG. Не змінюй його в наступних імпортах.'],
  ['Дисципліна', 'name обов’язковий; shortName, color, selectedGroup та lessons — необов’язкові. Додаткові поля не використовуй.'],
  ['Колір', 'Рекомендований формат #RRGGBB, наприклад #7b86c6.'],
  ['Обрана група', 'selectedGroup — додатне ціле число. Вона визначає, які групові заняття побачить користувач.'],
  ['Без занять', 'Дисципліна може мати lessons: [] — вона залишиться у переліку предметів.'],
  ['Одне правило', 'Один lesson описує незмінні день, час, тип, формат, викладача, аудиторію та групу для конкретного набору тижнів.'],
  ['Зміна умов', 'Якщо будь-яка умова змінюється між тижнями — створи окремий lesson.'],
  ['Тип заняття', 'type: lecture або group. Для group поле group обов’язкове та має бути додатним цілим числом.'],
  ['Дні', 'Тільки monday, tuesday, wednesday, thursday, friday, saturday. Sunday не підтримується.'],
  ['Час', 'startTime/endTime строго HH:mm із ведучим нулем; початок раніше завершення; перехід через північ заборонений.'],
  ['Тижні', 'Непорожній відсортований масив унікальних цілих чисел у межах семестру. Не рядок, не діапазон і не «парні».'],
  ['Формат', 'Тільки offline, online або hybrid.'],
  ['Викладач', 'teacher — непорожній рядок. Якщо викладача немає, вкажи «Вакансія».'],
  ['Аудиторія', 'room необов’язкова. Для online її зазвичай немає; для offline вкажи, якщо відома.'],
  ['ID заняття', 'id необов’язковий і зазвичай не потрібен: внутрішній ID створює сервер.'],
  ['Не дублюй предмет', 'Лекція і практика однієї дисципліни мають бути lessons усередині одного subject.'],
  ['Не вигадуй дані', 'Зберігай написання з джерела. Не додумуй викладача, аудиторію чи тижні.'],
];

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ImportGuidePage() {
  const { schedule, setSchedule, selectedUser, selectUser, source, loading, error, refresh, remoteConfigured } = useSchedule();
  const fileInput = useRef<HTMLInputElement>(null);
  const exported = useMemo(() => exportSchedule(schedule), [schedule]);
  const prompt = useMemo(() => buildLlmImportPrompt(schedule.semester.id, schedule.semester.weeksCount), [schedule.semester.id, schedule.semester.weeksCount]);
  const [token, setToken] = useState(() => getStoredEditToken(schedule.user.slug));
  const [importText, setImportText] = useState(() => JSON.stringify(scheduleImportExample, null, 2));
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [allowSharedUpdates, setAllowSharedUpdates] = useState(false);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setToken(getStoredEditToken(schedule.user.slug)), [schedule.user.slug]);

  const rememberToken = (value: string) => {
    setToken(value);
    storeEditToken(schedule.user.slug, value.trim());
  };

  const parseImport = () => {
    setMessage('');
    try {
      const result = validateScheduleImport(JSON.parse(importText), schedule.semester.weeksCount);
      setErrors(result.errors);
      return result.value;
    } catch {
      setErrors(['JSON має синтаксичну помилку. Перевір коми, лапки та дужки.']);
      return undefined;
    }
  };

  const previewOrImport = async (dryRun: boolean) => {
    const value = parseImport();
    if (!value) return;
    if (!remoteConfigured) {
      setErrors(['Remote API не налаштовано. JSON перевірено лише у браузері.']);
      return;
    }
    if (!token.trim()) {
      setErrors(['Введи персональний edit token вибраного користувача.']);
      return;
    }

    setBusy(true);
    try {
      const response = await importPersonalSchedule({
        userSlug: schedule.user.slug,
        token: token.trim(),
        schedule: value,
        mode,
        baseRevision: schedule.revision,
        allowSharedUpdates,
        dryRun,
      });
      setErrors([]);
      if (response.schedule) setSchedule(response.schedule);
      setMessage(dryRun
        ? `Перевірка успішна. Заплановано змін: ${Array.isArray(response.plan) ? response.plan.length : 0}. Дані ще не записані.`
        : `Імпорт завершено. Revision ${response.revision}.`);
      if (!dryRun) await refresh();
    } catch (importError) {
      const details = importError && typeof importError === 'object' && 'details' in importError ? (importError as { details?: unknown }).details : undefined;
      setErrors([
        importError instanceof Error ? importError.message : 'Не вдалося виконати імпорт.',
        ...(Array.isArray(details) ? details.map((item) => typeof item === 'string' ? item : JSON.stringify(item)) : []),
      ]);
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setImportText(await file.text());
    setErrors([]);
    setMessage(`Файл ${file.name} завантажено у редактор.`);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-20 -top-28 size-[380px] rounded-full bg-[#e8e2d2]/45 blur-3xl" />
        <div className="absolute -left-32 top-[38%] size-[340px] rounded-full bg-[#d9e7e5]/45 blur-3xl" />
      </div>

      <header className="relative border-b border-[#e8e4da]/80 bg-[#f8f6f0]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7 lg:px-10">
          <a href="#/" className="inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-semibold text-[#4d5657] hover:text-[#273033]"><ArrowLeft className="size-4" /> До розкладу</a>
          <label className="relative flex h-10 min-w-[190px] items-center gap-2 rounded-full border border-[#dedacf] bg-white/80 px-3.5 text-xs text-[#626764]">
            <UserRound className="size-3.5" />
            <select value={selectedUser} onChange={(event) => selectUser(event.target.value)} className="min-w-0 flex-1 appearance-none bg-transparent font-semibold outline-none" aria-label="Користувач для імпорту">
              {schedule.users.map((user) => <option key={user.id} value={user.slug}>{user.displayName}</option>)}
            </select>
          </label>
          <Badge variant="secondary" className="h-8 rounded-full border-0 bg-[#ebe8df] px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6f716c]">JSON schema v1</Badge>
        </div>
      </header>

      <div className="relative mx-auto max-w-[1240px] px-4 pb-24 pt-8 sm:px-7 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c47449]">Єдиний спосіб редагування</p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-[-0.055em] text-[#273033] sm:text-5xl">Імпорт розкладу</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#737771]">Встав готовий JSON або завантаж файл. Спочатку виконай безпечну перевірку, потім імпортуй.</p>
          </div>
          <div className="text-right text-xs leading-6 text-[#8b8d87]"><div>{schedule.semester.title} · {schedule.semester.weeksCount} тижнів</div><div>{source === 'remote' ? `Синхронізовано · revision ${schedule.revision}` : 'Показано локальні дані'}</div></div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(310px,.75fr)]">
          <section className="rounded-[26px] border border-[#e3dfd5] bg-white/80 p-4 shadow-[0_16px_55px_rgb(46_52_50/6%)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-xl font-semibold tracking-[-0.035em] text-[#293234]">JSON для імпорту</h2><p className="mt-1 text-xs text-[#8a8c86]">Користувач: {schedule.user.displayName}</p></div>
              <div className="flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => loadFile(event.target.files?.[0])} />
                <Button variant="outline" onClick={() => fileInput.current?.click()} className="h-9 rounded-xl"><Upload className="size-3.5" /> Відкрити файл</Button>
                <Button variant="outline" onClick={() => setImportText(JSON.stringify(exported, null, 2))} className="h-9 rounded-xl">Поточний JSON</Button>
              </div>
            </div>

            <label htmlFor="schedule-edit-token" className="mt-5 block text-xs font-semibold text-[#575e5e]">
              Персональний edit token
              <div className="relative mt-2">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8c908b]" />
                <Input id="schedule-edit-token" type="password" autoComplete="off" value={token} onChange={(event) => rememberToken(event.target.value)} placeholder="Зберігається тільки на цьому пристрої" className="h-11 rounded-[14px] pl-10" />
              </div>
            </label>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button onClick={() => setMode('merge')} className={`rounded-[15px] border p-3 text-left transition ${mode === 'merge' ? 'border-[#d48a60] bg-[#fff5ed]' : 'border-[#e3dfd5] bg-[#faf9f5]'}`}><div className="text-xs font-bold text-[#394143]">Merge</div><div className="mt-1 text-[11px] leading-5 text-[#83847e]">Додати або оновити перелічені дисципліни, не прибираючи інші.</div></button>
              <button onClick={() => setMode('replace')} className={`rounded-[15px] border p-3 text-left transition ${mode === 'replace' ? 'border-[#d48a60] bg-[#fff5ed]' : 'border-[#e3dfd5] bg-[#faf9f5]'}`}><div className="text-xs font-bold text-[#394143]">Replace my enrollments</div><div className="mt-1 text-[11px] leading-5 text-[#83847e]">Залишити користувачу лише дисципліни з цього JSON.</div></button>
            </div>

            <label className="mt-3 flex items-start gap-3 rounded-[14px] bg-[#f3f1eb] p-3 text-xs leading-5 text-[#676b68]"><input type="checkbox" checked={allowSharedUpdates} onChange={(event) => setAllowSharedUpdates(event.target.checked)} className="mt-1" /><span><strong className="text-[#424a4b]">Дозволити спільні зміни.</strong> Увімкни лише якщо треба замінити назву або заняття вже відомої дисципліни для всіх користувачів.</span></label>

            <Textarea value={importText} onChange={(event) => setImportText(event.target.value)} spellCheck={false} className="mt-4 min-h-[420px] rounded-[17px] bg-[#fbfaf7] font-mono text-xs leading-relaxed" aria-label="JSON розкладу" />

            {errors.length > 0 && <div className="mt-3 rounded-[14px] bg-[#fff0ed] px-4 py-3 text-xs leading-relaxed text-[#a64f45]" role="alert">{errors.map((validationError, index) => <div key={`${validationError}-${index}`}>• {validationError}</div>)}</div>}
            {message && <output className="mt-3 block rounded-[14px] bg-[#edf5ef] px-4 py-3 text-xs leading-5 text-[#50705a]">{message}</output>}
            {error && <div className="mt-3 text-xs text-[#a64f45]">{error}</div>}

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Button variant="outline" onClick={() => previewOrImport(true)} disabled={busy} className="h-11 rounded-[14px]"><FileJson2 className="size-4" /> Перевірити</Button>
              <Button onClick={() => previewOrImport(false)} disabled={busy || !remoteConfigured} className="h-11 rounded-[14px]"><Upload className="size-4" /> Імпортувати</Button>
              <Button variant="outline" onClick={() => downloadJson(`schedule-${schedule.user.slug}.json`, exported)} className="h-11 rounded-[14px]"><Download className="size-4" /> Експортувати</Button>
            </div>
            <Button variant="ghost" onClick={refresh} disabled={loading || !remoteConfigured} className="mt-2 w-full rounded-xl text-xs"><RefreshCw className={loading ? 'size-3.5 animate-spin' : 'size-3.5'} /> Оновити дані перед імпортом</Button>
          </section>

          <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
            <section className="rounded-[24px] bg-[#293638] p-5 text-white shadow-[0_18px_45px_rgb(41_54_56/15%)]">
              <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">Для ChatGPT / Claude / Gemini</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.035em]">Готовий промпт для LLM</h2></div><Clipboard className="size-5 text-[#f3b18a]" /></div>
              <p className="mt-3 text-xs leading-6 text-white/65">Скопіюй правила, встав у модель, а наступним повідомленням надішли скриншот або текст розкладу.</p>
              <Button onClick={copyPrompt} className="mt-5 h-11 w-full rounded-[14px] bg-white text-[#293638] hover:bg-white/90">{copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}{copied ? 'Промпт скопійовано' : 'Скопіювати промпт'}</Button>
            </section>

            <section className="rounded-[24px] border border-[#e3dfd5] bg-white/75 p-5">
              <h2 className="text-sm font-bold text-[#394143]">Безпечний порядок</h2>
              <ol className="mt-4 space-y-3 text-xs leading-5 text-[#737671]">{['Вибери правильного користувача.', 'Встав його персональний token.', 'Встав JSON та натисни «Перевірити».', 'Переглянь помилки або план змін.', 'Лише потім натисни «Імпортувати».'].map((step, index) => <li key={step} className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#efede7] text-[10px] font-bold text-[#596061]">{index + 1}</span><span>{step}</span></li>)}</ol>
            </section>

            <section className="rounded-[24px] border border-[#e8c9bc] bg-[#fff8f3] p-5"><div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-[#c36e45]" /><div><h2 className="text-sm font-bold text-[#6f4634]">Спільні дані</h2><p className="mt-2 text-xs leading-6 text-[#916854]">Назва та lessons дисципліни зі спільним externalCode використовуються всіма. Без прапорця імпорт з відмінностями буде зупинено без запису.</p></div></div></section>
          </aside>
        </div>

        <section className="mt-12 border-t border-[#e2ded4] pt-10">
          <div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8d8d85]">Повна специфікація</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#293234]">Усі правила імпорту</h2><p className="mt-3 text-sm leading-7 text-[#777a75]">Цей перелік відповідає перевіркам браузера та Apps Script. Його можна передавати іншій людині або LLM без доступу до коду проєкту.</p></div>
          <div className="mt-7 grid gap-3 md:grid-cols-2">{rules.map(([title, description], index) => <article key={title} className="flex gap-4 rounded-[19px] border border-[#e5e1d7] bg-white/70 p-4"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#293638] text-[10px] font-bold text-white">{index + 1}</span><div><h3 className="text-sm font-bold text-[#394143]">{title}</h3><p className="mt-1.5 text-xs leading-6 text-[#777a75]">{description}</p></div></article>)}</div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[24px] border border-[#e3dfd5] bg-white/75 p-5 sm:p-6">
            <h2 className="text-xl font-semibold tracking-[-0.035em] text-[#293234]">Точні допустимі значення</h2>
            <div className="mt-5 overflow-x-auto"><table className="w-full border-collapse text-left text-xs"><thead><tr className="border-b border-[#dfdbd1] text-[#8a8b84]"><th className="pb-3 pr-4 font-semibold">Поле</th><th className="pb-3 font-semibold">Значення</th></tr></thead><tbody className="align-top text-[#555d5e]">{[
              ['schemaVersion', '1'], ['semesterId', schedule.semester.id], ['type', 'lecture | group'], ['day', 'monday | tuesday | wednesday | thursday | friday | saturday'], ['format', 'offline | online | hybrid'], ['time', 'HH:mm, наприклад 08:30'], ['weeks', `цілі числа 1–${schedule.semester.weeksCount}`], ['selectedGroup / group', 'додатне ціле число'],
            ].map(([field, value]) => <tr key={field} className="border-b border-[#ece8df]"><td className="py-3 pr-4 font-mono font-semibold">{field}</td><td className="py-3 font-mono leading-5">{value}</td></tr>)}</tbody></table></div>
          </div>

          <div className="rounded-[24px] border border-[#e3dfd5] bg-[#293638] p-5 text-white sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold tracking-[-0.035em]">Приклад JSON</h2><CheckCircle2 className="size-5 text-[#8fc39f]" /></div><pre className="mt-5 max-h-[500px] overflow-auto rounded-[16px] bg-black/15 p-4 text-[11px] leading-5 text-white/75"><code>{JSON.stringify(scheduleImportExample, null, 2)}</code></pre></div>
        </section>

        <section className="mt-8 rounded-[24px] border border-[#e6b8b1] bg-[#fff5f2] p-5 sm:p-6"><div className="flex gap-4"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#ba5d4e]" /><div><h2 className="text-sm font-bold text-[#75473f]">Merge, Replace та конфлікти</h2><ul className="mt-3 space-y-2 text-xs leading-6 text-[#8c625b]"><li>• Merge не видаляє інші підписки користувача.</li><li>• Replace прибирає лише підписки цього користувача в поточному семестрі, яких немає у JSON; спільні предмети та заняття фізично не видаляються.</li><li>• Однаковий externalCode із відмінною назвою або lessons створює конфлікт. Без дозволу спільних змін весь імпорт зупиняється.</li><li>• Якщо revision застарів, онови дані, повтори перевірку та імпорт.</li><li>• «Перевірити» нічого не записує. Сервер застосовує успішний імпорт цілісно під блокуванням і веде AuditLog.</li></ul></div></div></section>
      </div>
    </main>
  );
}
