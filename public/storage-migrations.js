(function () {
  'use strict';

  const SCHEMA_VERSION_KEY = 'scheduler_storage_schema_version';
  const CURRENT_SCHEMA_VERSION = 3;
  const OLD_USER_SLUG = 'tymofii';
  const CURRENT_USER_SLUG = 'ermolz';
  const SELECTED_USER_KEY = 'scheduler_selected_user_v1';
  const USERS_CACHE_KEY = 'scheduler_users_v1';
  const CACHE_PREFIX = 'scheduler_cache_v1:';
  const EDIT_TOKEN_PREFIX = 'scheduler_edit_token_v1:';
  const LAST_SYNC_PREFIX = 'scheduler_last_sync_v1:';
  const PREFERENCES_PREFIX = 'scheduler_preferences_v2:';

  function normalizeUser(user) {
    if (!user || typeof user !== 'object' || user.slug !== OLD_USER_SLUG)
      return user;
    return Object.assign({}, user, {
      slug: CURRENT_USER_SLUG,
      displayName: user.displayName === 'Tymofii' ? 'Ermolz' : user.displayName,
    });
  }

  function normalizeUsers(users) {
    if (!Array.isArray(users)) return users;
    const normalized = new Map();
    users.forEach(function (user) {
      const wasLegacy =
        user && typeof user === 'object' && user.slug === OLD_USER_SLUG;
      const current = normalizeUser(user);
      if (
        !current ||
        typeof current !== 'object' ||
        typeof current.slug !== 'string'
      )
        return;
      if (!wasLegacy || !normalized.has(current.slug))
        normalized.set(current.slug, current);
    });
    return Array.from(normalized.values());
  }

  function normalizeSchedule(raw) {
    try {
      const schedule = JSON.parse(raw);
      if (!schedule || typeof schedule !== 'object') return raw;
      if (Array.isArray(schedule.users))
        schedule.users = normalizeUsers(schedule.users);
      if (schedule.user) schedule.user = normalizeUser(schedule.user);
      return JSON.stringify(schedule);
    } catch {
      return raw;
    }
  }

  function moveKey(oldKey, currentKey, transform) {
    const value = localStorage.getItem(oldKey);
    if (value === null) return;
    if (localStorage.getItem(currentKey) === null) {
      localStorage.setItem(currentKey, transform ? transform(value) : value);
    }
    localStorage.removeItem(oldKey);
  }

  function migrateToVersion2() {
    if (localStorage.getItem(SELECTED_USER_KEY) === OLD_USER_SLUG) {
      localStorage.setItem(SELECTED_USER_KEY, CURRENT_USER_SLUG);
    }

    moveKey(
      EDIT_TOKEN_PREFIX + OLD_USER_SLUG,
      EDIT_TOKEN_PREFIX + CURRENT_USER_SLUG,
    );
    moveKey(
      PREFERENCES_PREFIX + OLD_USER_SLUG,
      PREFERENCES_PREFIX + CURRENT_USER_SLUG,
    );

    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) keys.push(key);
    }

    keys.forEach(function (key) {
      if (key.startsWith(CACHE_PREFIX)) {
        const suffix = key.slice(CACHE_PREFIX.length);
        if (suffix.startsWith(OLD_USER_SLUG + ':')) {
          moveKey(
            key,
            CACHE_PREFIX +
              CURRENT_USER_SLUG +
              suffix.slice(OLD_USER_SLUG.length),
            normalizeSchedule,
          );
          return;
        }
        const raw = localStorage.getItem(key);
        if (raw !== null) localStorage.setItem(key, normalizeSchedule(raw));
        return;
      }

      if (key.startsWith(LAST_SYNC_PREFIX + OLD_USER_SLUG + ':')) {
        moveKey(
          key,
          LAST_SYNC_PREFIX +
            CURRENT_USER_SLUG +
            key.slice((LAST_SYNC_PREFIX + OLD_USER_SLUG).length),
        );
      }
    });

    const usersRaw = localStorage.getItem(USERS_CACHE_KEY);
    if (usersRaw !== null) {
      try {
        const users = JSON.parse(usersRaw);
        localStorage.setItem(
          USERS_CACHE_KEY,
          JSON.stringify(normalizeUsers(users)),
        );
      } catch {
        // Keep a damaged cache untouched; the repository will safely ignore it.
      }
    }
  }

  function migrateToVersion3() {
    // Old tokens were saved automatically, so their presence is not consent.
    // Preserve access in this tab, but require a new explicit opt-in to persist.
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(EDIT_TOKEN_PREFIX)) keys.push(key);
    }
    keys.forEach(function (key) {
      const currentKey =
        'scheduler_edit_token_v2:' + key.slice(EDIT_TOKEN_PREFIX.length);
      const value = localStorage.getItem(key);
      if (
        value &&
        sessionStorage.getItem(currentKey) === null &&
        localStorage.getItem(currentKey) === null
      ) {
        // Do not delete the only copy if tab storage is unavailable. Retry the
        // migration on the next load; the application never reads legacy keys.
        sessionStorage.setItem(currentKey, value);
      }
      localStorage.removeItem(key);
    });
  }

  try {
    const storedVersion = Number(localStorage.getItem(SCHEMA_VERSION_KEY) || 1);
    const version = Number.isInteger(storedVersion) ? storedVersion : 1;
    const migrations = [
      [2, migrateToVersion2],
      [3, migrateToVersion3],
    ];
    for (const [target, migrate] of migrations) {
      if (version < target && target <= CURRENT_SCHEMA_VERSION) {
        migrate();
        localStorage.setItem(SCHEMA_VERSION_KEY, String(target));
      }
    }
  } catch {
    // The application remains usable when browser storage is unavailable.
  }
})();
