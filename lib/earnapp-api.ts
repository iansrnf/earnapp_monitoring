export type BrowserCookieExport = {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
};

export function getEnvValue(name: string) {
  return process.env[name]?.trim() || "";
}

export function getXsrfToken(cookie: string) {
  const match = cookie.match(/(?:^|;\s*)xsrf-token=([^;]+)/);

  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function getCookieHeader(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const cookieText = value.trim();

  if (!cookieText) {
    return "";
  }

  if (!cookieText.startsWith("[") && !cookieText.startsWith("{")) {
    return cookieText.replace(/^cookie:\s*/i, "").trim();
  }

  try {
    const parsedCookie = JSON.parse(cookieText) as unknown;

    if (
      parsedCookie &&
      typeof parsedCookie === "object" &&
      !Array.isArray(parsedCookie) &&
      typeof (parsedCookie as { cookie?: unknown }).cookie === "string"
    ) {
      return ((parsedCookie as { cookie: string }).cookie).trim();
    }

    const cookies = Array.isArray(parsedCookie) ? parsedCookie : Object.values(parsedCookie as Record<string, unknown>);

    return cookies
      .map((cookie): BrowserCookieExport | null => (cookie && typeof cookie === "object" ? (cookie as BrowserCookieExport) : null))
      .filter((cookie): cookie is BrowserCookieExport => {
        const domain = typeof cookie?.domain === "string" ? cookie.domain : "";

        return typeof cookie?.name === "string" && typeof cookie?.value === "string" && (!domain || domain.includes("earnapp.com"));
      })
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  } catch {
    return "";
  }
}

export function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function toNumber(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : 0;
}
