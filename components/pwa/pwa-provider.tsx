/* oxlint-disable next/no-img-element -- Vite app; this fixed-size local PNG is precached. */
import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PwaClient, PwaState } from '@/lib/pwa/client';

interface PwaContextValue {
  state: PwaState;
  showInstall: () => void;
  showUpdate: () => void;
}
const PwaContext = createContext<PwaContextValue | null>(null);
export const usePwa = () => useContext(PwaContext);

export function PwaProvider({
  client,
  children,
}: {
  client: PwaClient;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const [dialog, setDialog] = useState<'install' | 'update' | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <PwaContext.Provider
      value={{
        state,
        showInstall: () => setDialog('install'),
        showUpdate: () => setDialog('update'),
      }}
    >
      {state.enabled && state.notice && (
        <aside
          aria-label="App availability"
          className="border-b border-border bg-info-soft px-4 py-2 text-info-foreground"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <output className="min-w-0 flex-1 basis-40">
              {state.updateAvailable
                ? 'A new app version is ready.'
                : 'App ready offline. Opened schedules remain available on this device.'}
            </output>
            {state.updateAvailable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialog('update')}
              >
                Review update
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss app notice"
              onClick={client.dismissNotice}
            >
              <X className="size-4" />
            </Button>
          </div>
        </aside>
      )}
      {children}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          initialFocus={title}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle
              ref={title}
              tabIndex={-1}
              className="pr-6 leading-6 outline-none"
            >
              {dialog === 'update'
                ? 'Update My Schedule'
                : state.installed
                  ? 'My Schedule is installed'
                  : 'Add to home screen'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'update'
                ? 'Save unfinished changes before updating.'
                : 'Open your schedule like an app, without searching for a browser tab.'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'update' ? (
            <>
              <p className="text-sm leading-6">
                This window will reload. Finish imports and editing first, and
                close other My Schedule windows after saving their drafts. Saved
                schedules and pending preference changes are kept.
              </p>
              {!state.updateAvailable && (
                <output className="text-sm text-muted-foreground">
                  The update has already been activated. Reopen the app when you
                  have saved your changes.
                </output>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                <img
                  src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
                  width={48}
                  height={48}
                  alt=""
                  className="rounded-xl"
                />
                <div>
                  <p className="font-medium">My Schedule</p>
                  <p className="text-xs text-muted-foreground">
                    Your personal university schedule
                  </p>
                </div>
              </div>
              {state.installed ? (
                <p className="text-sm">
                  You can open the app from your device’s home screen or app
                  list.
                </p>
              ) : !state.canInstall && state.installResult !== 'prompting' ? (
                <div className="space-y-3 text-sm leading-6">
                  <p>
                    <strong>iPhone / iPad:</strong> open this site in Safari →
                    Share → Add to Home Screen. If offered, enable Open as Web
                    App.
                  </p>
                  <p>
                    <strong>Android / computer:</strong> use your browser’s
                    Install app or Add to Home screen menu. If it is missing,
                    open the site in a supported browser such as Chrome or Edge,
                    outside private browsing.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your browser decides whether installation is available. You
                    can always keep using the website.
                  </p>
                </div>
              ) : null}
              {state.installResult === 'accepted' && !state.installed && (
                <output>
                  Installation requested. Complete any device prompts; the app
                  icon will appear when installation finishes.
                </output>
              )}
              {state.installResult === 'dismissed' && (
                <output>
                  Installation canceled. You can still install later from your
                  browser menu.
                </output>
              )}
              {state.installResult === 'error' && (
                <p role="alert">
                  Installation could not start. Use the browser menu
                  instructions above.
                </p>
              )}
              <output className="rounded-xl bg-muted/60 p-3 text-xs leading-5">
                {state.offline === 'ready'
                  ? 'Offline shell is ready.'
                  : state.offline === 'preparing'
                    ? 'Preparing the offline shell. Keep this page open while connected.'
                    : 'Offline shell is not ready on this browser yet.'}{' '}
                Open each personal semester online once to save its data.
                Without a saved copy, only the built-in example is available.
                Synchronization, imports and administration still require
                internet.
              </output>
              <p className="text-xs leading-5 text-muted-foreground">
                The PIN and permissions remain unchanged. Some devices keep
                installed-app storage separate: you may need to sign in and
                synchronize again. Clearing browser/app data also removes
                offline copies.
              </p>
            </>
          )}
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {dialog === 'update' ? 'Later' : 'Done'}
            </Button>
            {dialog === 'update' ? (
              <Button
                disabled={!state.updateAvailable || state.updating}
                onClick={client.applyUpdate}
              >
                <RefreshCw className="size-4" />
                {state.updating ? 'Updating…' : 'Update and reload'}
              </Button>
            ) : state.canInstall && !state.installed ? (
              <Button onClick={() => void client.install()}>
                <Download className="size-4" />
                Install app
              </Button>
            ) : state.offline === 'error' || state.error ? (
              <Button onClick={() => void client.checkForUpdate()}>
                Retry offline setup
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PwaContext.Provider>
  );
}

export function PwaInstallButton() {
  const pwa = usePwa();
  if (!pwa?.state.enabled) return null;
  return (
    <Button
      variant="link"
      className="mt-2 w-full text-xs"
      onClick={pwa.state.updateAvailable ? pwa.showUpdate : pwa.showInstall}
    >
      {pwa.state.updateAvailable ? (
        <RefreshCw className="size-3.5" />
      ) : (
        <Download className="size-3.5" />
      )}
      {pwa.state.updateAvailable
        ? 'Update app'
        : pwa.state.installed
          ? 'App information'
          : 'Add to home screen'}
    </Button>
  );
}
