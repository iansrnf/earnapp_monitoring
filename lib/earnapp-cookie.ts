export type SavedEarnAppCookie = {
  cookie: string;
  expiresAt: number;
};

export const EARNAPP_COOKIE_STORAGE_KEY = "earnapp-cookie-cache";
export const EARNAPP_COOKIE_NEVER_EXPIRES_AT = 8_640_000_000_000_000;

export function saveEarnAppCookie(storage: Storage, cookie: string) {
  const savedValue: SavedEarnAppCookie = {
    cookie,
    expiresAt: EARNAPP_COOKIE_NEVER_EXPIRES_AT,
  };

  storage.setItem(EARNAPP_COOKIE_STORAGE_KEY, JSON.stringify(savedValue));

  return savedValue;
}

export function getValidSavedEarnAppCookie(storage: Storage, now = Date.now()) {
  try {
    const storedCookie = storage.getItem(EARNAPP_COOKIE_STORAGE_KEY);

    if (!storedCookie) {
      return null;
    }

    const parsedCookie = JSON.parse(storedCookie) as SavedEarnAppCookie;

    if (typeof parsedCookie.cookie !== "string" || !Number.isFinite(parsedCookie.expiresAt)) {
      return null;
    }

    if (parsedCookie.expiresAt <= now) {
      storage.removeItem(EARNAPP_COOKIE_STORAGE_KEY);
      return null;
    }

    return parsedCookie;
  } catch {
    storage.removeItem(EARNAPP_COOKIE_STORAGE_KEY);
    return null;
  }
}

export function getSavedEarnAppCookieTimeLeft(expiresAt: number | null, now = Date.now()) {
  if (!expiresAt) {
    return "not saved";
  }

  if (expiresAt >= EARNAPP_COOKIE_NEVER_EXPIRES_AT) {
    return "saved until edited";
  }

  const remainingMinutes = Math.max(0, Math.ceil((expiresAt - now) / 60_000));

  if (remainingMinutes >= 1_440) {
    return "valid for 1 day";
  }

  if (remainingMinutes >= 60) {
    const remainingHours = Math.ceil(remainingMinutes / 60);

    return `valid for ${remainingHours} hour${remainingHours === 1 ? "" : "s"}`;
  }

  return `valid for ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`;
}
