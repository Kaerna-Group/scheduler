(function () {
  const defaults = {
    mode: 'light',
    themeId: 'paper-current',
    systemLightThemeId: 'paper-current',
    systemDarkThemeId: 'graphite-current',
    reducedMotion: 'system'
  };
  const lightThemes = ['air-light', 'paper-current', 'stone-light', 'azure-notebook', 'sage-morning'];
  const darkThemes = ['midnight-black', 'graphite-current', 'dusk-gray', 'navy-electric', 'plum-night'];
  let appearance = defaults;
  try {
    const stored = JSON.parse(localStorage.getItem('scheduler_preferences_v1') || 'null');
    if (stored && stored.version === 1 && stored.appearance) appearance = Object.assign({}, defaults, stored.appearance);
  } catch {}
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let mode = appearance.mode === 'system' ? (systemDark ? 'dark' : 'light') : appearance.mode;
  if (mode !== 'dark') mode = 'light';
  const candidates = mode === 'dark' ? darkThemes : lightThemes;
  const requested = appearance.mode === 'system'
    ? (mode === 'dark' ? appearance.systemDarkThemeId : appearance.systemLightThemeId)
    : appearance.themeId;
  const fallback = mode === 'dark' ? defaults.systemDarkThemeId : defaults.systemLightThemeId;
  const themeId = candidates.indexOf(requested) >= 0 ? requested : fallback;
  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.dataset.mode = mode;
  root.dataset.reducedMotion = ['system', 'reduce', 'allow'].indexOf(appearance.reducedMotion) >= 0 ? appearance.reducedMotion : 'system';
  root.classList.toggle('dark', mode === 'dark');
})();
