"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, FileUp, History, Pencil, RefreshCw, Save, Search, Smartphone, Trash2, X } from "lucide-react";
import {
  EARNAPP_COOKIE_STORAGE_KEY,
  EARNAPP_COOKIE_NEVER_EXPIRES_AT,
  getSavedEarnAppCookieTimeLeft,
  getValidSavedEarnAppCookie,
  saveEarnAppCookie,
} from "@/lib/earnapp-cookie";

type EarnAppDevice = {
  [key: string]: unknown;
  uuid: string;
  title: string;
  rate: number;
  earned: number;
  earned_total: number;
  country: string;
  ips: string[];
  billing: string;
  uptime: number;
  total_uptime: number;
  raw?: unknown;
};

type EarnAppUsagePoint = {
  date: string;
  usage: number;
  earned: number;
  raw: unknown;
};

type EarnAppDeviceUsage = {
  uuid: string;
  title: string;
  totalUsage: number;
  totalEarned: number;
  points: EarnAppUsagePoint[];
};

type UsageRow = {
  key: string;
  device: EarnAppDevice;
  point: EarnAppUsagePoint;
};

type ForecastRow = {
  device: EarnAppDevice;
  days: number;
  avgUsage: number;
  avgEarned: number;
  sevenDayEarned: number;
  thirtyDayEarned: number;
};

type DailyForecastRow = ForecastRow & {
  actualPoint: EarnAppUsagePoint | null;
  displayUsage: number;
  displayEarned: number;
  hasNoUsage: boolean;
};

type DeviceGroup = {
  key: string;
  label: string;
  devices: EarnAppDevice[];
  activeCount: number;
  earned: number;
  totalEarned: number;
  forecastEarned: number;
};

type WatchlistStatus = "passing" | "pending" | "failed" | "missing" | "invalid";

type WatchlistRow = {
  device: EarnAppDevice;
  createdAtValue: string;
  createdAt: Date | null;
  deadlineAt: Date | null;
  usage: number;
  elapsed: number;
  status: WatchlistStatus;
};

type Tab = "groups" | "devices" | "forecast" | "watchlist" | "usage";
type SortDirection = "asc" | "desc";
type SortConfig = {
  tab: Tab;
  key: string;
  direction: SortDirection;
};

const EARNAPP_HOURLY_RATE_USD = 0.0069;
const EARNAPP_DEVICE_CREATED_AT_STORAGE_KEY = "earnapp-device-created-at";
const WATCHLIST_TARGET_USAGE_MINUTES_STORAGE_KEY = "earnapp-watchlist-target-usage-minutes";
const WATCHLIST_TARGET_HOURS_STORAGE_KEY = "earnapp-watchlist-target-hours";
const WATCHLIST_WINDOW_MS = 6 * 60 * 60 * 1000;
const WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES = 270;
const WATCHLIST_MIN_TARGET_USAGE_MINUTES = 1;
const WATCHLIST_MAX_TARGET_USAGE_MINUTES = 24 * 60;

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatUptime(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "offline";
  }

  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatUsageDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function getUsageEarned(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return (value / 3_600_000) * EARNAPP_HOURLY_RATE_USD;
}

function getWatchlistTargetUsageMs(targetMinutes: number) {
  return targetMinutes * 60 * 1000;
}

function normalizeWatchlistTargetUsageMinutes(value: string | number) {
  const parsedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < WATCHLIST_MIN_TARGET_USAGE_MINUTES || parsedValue > WATCHLIST_MAX_TARGET_USAGE_MINUTES) {
    return null;
  }

  return Math.round(parsedValue);
}

function getWatchlistTargetParts(targetMinutes: number) {
  return {
    hours: Math.floor(targetMinutes / 60),
    minutes: targetMinutes % 60,
  };
}

function isEarnAppDeviceActive(device: EarnAppDevice) {
  return device.uptime > 0 || device.earned > 0;
}

function getSearchText(device: EarnAppDevice) {
  return JSON.stringify(device.raw ?? device).toLowerCase();
}

function getUsageMatchKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function getTodayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDeviceDateKey(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeDateTimeLocalValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00`;
  }

  return value.slice(0, 16);
}

function formatCreatedAt(value: string | undefined) {
  if (!value) {
    return "Not set";
  }

  return formatDate(value);
}

function getWatchlistStatusLabel(status: WatchlistStatus) {
  if (status === "passing") {
    return "Passed";
  }

  if (status === "pending") {
    return "Pending";
  }

  if (status === "failed") {
    return "Failed";
  }

  if (status === "invalid") {
    return "Invalid date";
  }

  return "Set Created At";
}

function getComparableValue(value: string | number | boolean | Date | null | undefined) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    const dateValue = Date.parse(trimmedValue);

    if (trimmedValue && !Number.isNaN(dateValue) && /\d{4}-\d{2}-\d{2}/.test(trimmedValue)) {
      return dateValue;
    }

    return trimmedValue.toLowerCase();
  }

  return "";
}

function sortRows<T>(rows: T[], sortConfig: SortConfig | null, tab: Tab, getValue: (row: T, key: string) => string | number | boolean | Date | null | undefined) {
  if (!sortConfig || sortConfig.tab !== tab) {
    return rows;
  }

  return rows.slice().sort((firstRow, secondRow) => {
    const firstValue = getComparableValue(getValue(firstRow, sortConfig.key));
    const secondValue = getComparableValue(getValue(secondRow, sortConfig.key));
    const direction = sortConfig.direction === "asc" ? 1 : -1;

    if (typeof firstValue === "number" && typeof secondValue === "number") {
      return (firstValue - secondValue) * direction;
    }

    return String(firstValue).localeCompare(String(secondValue), undefined, { numeric: true }) * direction;
  });
}

function getDeviceGroupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s._-]*\d+$/g, "")
    .trim();
}

function getDeviceGroupLabel(device: EarnAppDevice) {
  const key = getDeviceGroupKey(device.title);

  return key || device.title || "Unnamed group";
}

function getCookieValue(name: string) {
  if (typeof document === "undefined") {
    return "";
  }

  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function setCookieValue(value: string) {
  if (typeof document === "undefined") {
    return;
  }

  const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ?? Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");

  cookieDescriptor?.set?.call(document, value);
}

function getSavedDeviceCreatedAtMap() {
  try {
    if (typeof window === "undefined") {
      return {};
    }

    const storedValue = window.localStorage.getItem(EARNAPP_DEVICE_CREATED_AT_STORAGE_KEY) || getCookieValue(EARNAPP_DEVICE_CREATED_AT_STORAGE_KEY);

    if (!storedValue) {
      return {};
    }

    const parsedValue = JSON.parse(storedValue) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsedValue).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function getSavedWatchlistTargetUsageMinutes() {
  try {
    if (typeof window === "undefined") {
      return WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES;
    }

    const storedMinutes = window.localStorage.getItem(WATCHLIST_TARGET_USAGE_MINUTES_STORAGE_KEY) || getCookieValue(WATCHLIST_TARGET_USAGE_MINUTES_STORAGE_KEY);
    const targetMinutes = storedMinutes ? normalizeWatchlistTargetUsageMinutes(storedMinutes) : null;

    if (targetMinutes !== null) {
      return targetMinutes;
    }

    const storedHours = window.localStorage.getItem(WATCHLIST_TARGET_HOURS_STORAGE_KEY) || getCookieValue(WATCHLIST_TARGET_HOURS_STORAGE_KEY);
    const targetHours = storedHours ? Number(storedHours) : null;

    if (targetHours !== null && Number.isFinite(targetHours)) {
      return normalizeWatchlistTargetUsageMinutes(targetHours * 60) ?? WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES;
    }

    return WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES;
  } catch {
    return WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES;
  }
}

export default function EarnappDevicesPage() {
  const [cookie, setCookie] = useState("");
  const [savedCookie, setSavedCookie] = useState("");
  const [savedCookieExpiresAt, setSavedCookieExpiresAt] = useState<number | null>(null);
  const [editingCookie, setEditingCookie] = useState(true);
  const [devices, setDevices] = useState<EarnAppDevice[]>([]);
  const [usageByDevice, setUsageByDevice] = useState<Record<string, EarnAppDeviceUsage>>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [usageCheckedAt, setUsageCheckedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("groups");
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [forecastDate, setForecastDate] = useState(getTodayDateInputValue);
  const [selectedDeviceUuids, setSelectedDeviceUuids] = useState<string[]>([]);
  const [selectedForecastUuids, setSelectedForecastUuids] = useState<string[]>([]);
  const [deviceCreatedAtByUuid, setDeviceCreatedAtByUuid] = useState<Record<string, string>>({});
  const [createdAtModalDevice, setCreatedAtModalDevice] = useState<EarnAppDevice | null>(null);
  const [createdAtDraft, setCreatedAtDraft] = useState("");
  const [watchlistTargetUsageMinutes, setWatchlistTargetUsageMinutes] = useState(WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES);
  const [watchlistTargetHoursDraft, setWatchlistTargetHoursDraft] = useState(String(getWatchlistTargetParts(WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES).hours));
  const [watchlistTargetMinutesDraft, setWatchlistTargetMinutesDraft] = useState(String(getWatchlistTargetParts(WATCHLIST_DEFAULT_TARGET_USAGE_MINUTES).minutes));
  const [usageModalDevice, setUsageModalDevice] = useState<EarnAppDevice | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cookieFileInputRef = useRef<HTMLInputElement | null>(null);
  const createdAtFileInputRef = useRef<HTMLInputElement | null>(null);
  const autoLoadedCookieRef = useRef("");

  const activeCookie = savedCookieExpiresAt ? savedCookie : "";
  const watchlistTargetUsageMs = getWatchlistTargetUsageMs(watchlistTargetUsageMinutes);

  function toggleSort(key: string) {
    setSortConfig((currentSort) => ({
      tab,
      key,
      direction: currentSort?.tab === tab && currentSort.key === key && currentSort.direction === "asc" ? "desc" : "asc",
    }));
  }

  function getSortLabel(key: string) {
    if (sortConfig?.tab !== tab || sortConfig.key !== key) {
      return "";
    }

    return sortConfig.direction === "asc" ? " ↑" : " ↓";
  }

  function renderSortHeader(label: string, key: string) {
    return (
      <button type="button" className="sortHeaderButton" onClick={() => toggleSort(key)}>
        {label}
        <span>{getSortLabel(key)}</span>
      </button>
    );
  }

  const applySavedCookie = useCallback((nextCookie: string, expiresAt: number) => {
    setSavedCookie(nextCookie);
    setSavedCookieExpiresAt(expiresAt);
    setCookie(nextCookie);
    setEditingCookie(false);
  }, []);

  useEffect(() => {
    window.queueMicrotask(() => {
      const savedTargetMinutes = getSavedWatchlistTargetUsageMinutes();
      const savedTargetParts = getWatchlistTargetParts(savedTargetMinutes);

      setDeviceCreatedAtByUuid(getSavedDeviceCreatedAtMap());
      setWatchlistTargetUsageMinutes(savedTargetMinutes);
      setWatchlistTargetHoursDraft(String(savedTargetParts.hours));
      setWatchlistTargetMinutesDraft(String(savedTargetParts.minutes));
    });
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!savedCookieExpiresAt) {
      return;
    }

    if (savedCookieExpiresAt >= EARNAPP_COOKIE_NEVER_EXPIRES_AT) {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        setSavedCookie("");
        setSavedCookieExpiresAt(null);
        setEditingCookie(true);
        window.localStorage.removeItem(EARNAPP_COOKIE_STORAGE_KEY);
      },
      Math.max(0, savedCookieExpiresAt - Date.now()),
    );

    return () => window.clearTimeout(timeout);
  }, [savedCookieExpiresAt]);

  function requireActiveCookie() {
    if (activeCookie) {
      return activeCookie;
    }

    setSavedCookie("");
    setSavedCookieExpiresAt(null);
    setEditingCookie(true);
    window.localStorage.removeItem(EARNAPP_COOKIE_STORAGE_KEY);
    setError("Your saved Earnapp cookie expired. Paste or upload it again.");

    return "";
  }

  function saveCookie() {
    const nextCookie = cookie.trim();

    if (!nextCookie) {
      setError("Paste or upload your Earnapp cookie first.");
      return;
    }

    const savedValue = saveEarnAppCookie(window.localStorage, nextCookie);

    applySavedCookie(savedValue.cookie, savedValue.expiresAt);
    setError(null);
  }

  async function uploadCookieFile(file: File) {
    const text = await file.text();
    let nextCookie = text;

    try {
      const parsedValue = JSON.parse(text) as { cookie?: unknown };

      if (typeof parsedValue.cookie === "string") {
        nextCookie = parsedValue.cookie;
      }
    } catch {
      nextCookie = text;
    }

    setCookie(nextCookie);
    setEditingCookie(true);
    setError(null);
  }

  function persistDeviceCreatedAtMap(nextDates: Record<string, string>) {
    const serializedDates = JSON.stringify(nextDates);

    window.localStorage.setItem(EARNAPP_DEVICE_CREATED_AT_STORAGE_KEY, serializedDates);
    setCookieValue(`${EARNAPP_DEVICE_CREATED_AT_STORAGE_KEY}=${encodeURIComponent(serializedDates)}; Max-Age=31536000; Path=/; SameSite=Lax`);
  }

  function persistWatchlistTargetUsageMinutes(nextTargetMinutes: number) {
    setWatchlistTargetUsageMinutes(nextTargetMinutes);
    window.localStorage.setItem(WATCHLIST_TARGET_USAGE_MINUTES_STORAGE_KEY, String(nextTargetMinutes));
    window.localStorage.removeItem(WATCHLIST_TARGET_HOURS_STORAGE_KEY);
    setCookieValue(`${WATCHLIST_TARGET_USAGE_MINUTES_STORAGE_KEY}=${encodeURIComponent(String(nextTargetMinutes))}; Max-Age=31536000; Path=/; SameSite=Lax`);
  }

  function saveWatchlistTargetUsageDraft(nextHours: string, nextMinutes: string) {
    const parsedHours = Number(nextHours);
    const parsedMinutes = Number(nextMinutes);

    if (!Number.isInteger(parsedHours) || !Number.isInteger(parsedMinutes) || parsedHours < 0 || parsedMinutes < 0 || parsedMinutes > 59) {
      return;
    }

    const nextTargetMinutes = normalizeWatchlistTargetUsageMinutes(parsedHours * 60 + parsedMinutes);

    if (nextTargetMinutes === null) {
      return;
    }

    persistWatchlistTargetUsageMinutes(nextTargetMinutes);
  }

  function restoreWatchlistTargetDrafts() {
    const targetParts = getWatchlistTargetParts(watchlistTargetUsageMinutes);

    setWatchlistTargetHoursDraft(String(targetParts.hours));
    setWatchlistTargetMinutesDraft(String(targetParts.minutes));
  }

  async function uploadCreatedAtFile(file: File) {
    const text = await file.text();

    try {
      const parsedValue = JSON.parse(text) as unknown;
      const createdAtMap =
        parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue) && "createdAtByUuid" in parsedValue
          ? (parsedValue as { createdAtByUuid?: unknown }).createdAtByUuid
          : parsedValue;

      if (!createdAtMap || typeof createdAtMap !== "object" || Array.isArray(createdAtMap)) {
        throw new Error("Invalid Created At JSON.");
      }

      const nextDates = Object.fromEntries(
        Object.entries(createdAtMap).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
      );

      setDeviceCreatedAtByUuid(nextDates);
      persistDeviceCreatedAtMap(nextDates);
      setError(null);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import Created At JSON.");
    }
  }

  function exportCreatedAtFile() {
    const payload = {
      exportedAt: new Date().toISOString(),
      type: "earnapp-device-created-at",
      createdAtByUuid: deviceCreatedAtByUuid,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `earnapp-created-at-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setError(null);
  }

  async function loadEarnappDevices() {
    const pastedCookie = requireActiveCookie();

    if (!pastedCookie) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [devicesResponse, usageResponse] = await Promise.all([
        fetch("/api/earnapp/devices", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookie: pastedCookie }),
        }),
        fetch("/api/earnapp/usage", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookie: pastedCookie }),
        }),
      ]);
      const devicesResult = (await devicesResponse.json()) as { checkedAt?: string; devices?: EarnAppDevice[]; error?: string };
      const usageResult = (await usageResponse.json()) as {
        checkedAt?: string;
        usageByDevice?: Record<string, EarnAppDeviceUsage>;
        error?: string;
      };

      if (!devicesResponse.ok) {
        throw new Error(devicesResult.error ?? "Failed to load Earnapp devices.");
      }

      setDevices(devicesResult.devices ?? []);
      setCheckedAt(devicesResult.checkedAt ?? new Date().toISOString());
      setUsageByDevice(usageResponse.ok ? (usageResult.usageByDevice ?? {}) : {});
      setUsageCheckedAt(usageResponse.ok ? (usageResult.checkedAt ?? new Date().toISOString()) : null);
      setSelectedDeviceUuids([]);

      if (!usageResponse.ok) {
        setError(usageResult.error ? `Devices loaded, but usage failed: ${usageResult.error}` : "Devices loaded, but usage failed.");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Earnapp devices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const parsedCookie = getValidSavedEarnAppCookie(window.localStorage);

    if (!parsedCookie) {
      return;
    }

    const savedValue = saveEarnAppCookie(window.localStorage, parsedCookie.cookie);

    window.queueMicrotask(() => {
      applySavedCookie(savedValue.cookie, savedValue.expiresAt);
      autoLoadedCookieRef.current = parsedCookie.cookie;
    });
  }, [applySavedCookie]);

  useEffect(() => {
    if (!activeCookie || autoLoadedCookieRef.current !== activeCookie || loading || devices.length > 0) {
      return;
    }

    autoLoadedCookieRef.current = "";
    void loadEarnappDevices();
  }, [activeCookie, devices.length, loading]);

  const getDeviceUsage = useCallback(
    (device: EarnAppDevice) => {
      const directUsage = usageByDevice[device.uuid];

      if (directUsage) {
        return directUsage;
      }

      const deviceTitleKey = getUsageMatchKey(device.title);

      return (
        Object.values(usageByDevice).find(
          (usage) => getUsageMatchKey(usage.uuid) === getUsageMatchKey(device.uuid) || getUsageMatchKey(usage.title) === deviceTitleKey,
        ) ?? null
      );
    },
    [usageByDevice],
  );

  function toggleSelectedDevice(device: EarnAppDevice) {
    const uuid = device.uuid.trim();

    if (!uuid) {
      return;
    }

    setSelectedDeviceUuids((currentUuids) =>
      currentUuids.includes(uuid) ? currentUuids.filter((currentUuid) => currentUuid !== uuid) : [...currentUuids, uuid],
    );
  }

  function saveDeviceCreatedAt(device: EarnAppDevice, value: string) {
    const uuid = device.uuid.trim();

    if (!uuid) {
      return;
    }

    setDeviceCreatedAtByUuid((currentDates) => {
      const nextDates = { ...currentDates };

      if (value) {
        nextDates[uuid] = value;
      } else {
        delete nextDates[uuid];
      }

      persistDeviceCreatedAtMap(nextDates);

      return nextDates;
    });
  }

  function openCreatedAtModal(device: EarnAppDevice) {
    setCreatedAtModalDevice(device);
    setCreatedAtDraft(normalizeDateTimeLocalValue(deviceCreatedAtByUuid[device.uuid] ?? ""));
  }

  function saveCreatedAtDraft() {
    if (!createdAtModalDevice) {
      return;
    }

    saveDeviceCreatedAt(createdAtModalDevice, createdAtDraft);
    setCreatedAtModalDevice(null);
    setCreatedAtDraft("");
  }

  async function deleteDevices(devicesToDelete: EarnAppDevice[], confirmationLabel?: string) {
    const pastedCookie = requireActiveCookie();
    const deleteableDevices = devicesToDelete.filter((device) => device.uuid.trim());

    if (!pastedCookie || deleteableDevices.length === 0) {
      return;
    }

    const label = confirmationLabel ?? (deleteableDevices.length === 1 ? deleteableDevices[0].title || deleteableDevices[0].uuid : `${deleteableDevices.length} devices`);
    const confirmed = window.confirm(`Are you sure you want to delete ${label}?`);

    if (!confirmed) {
      return;
    }

    setDeletingKey(deleteableDevices.map((device) => device.uuid).join("|"));
    setError(null);

    try {
      for (const device of deleteableDevices) {
        const response = await fetch(`/api/earnapp/device/${encodeURIComponent(device.uuid)}`, {
          method: "DELETE",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookie: pastedCookie }),
        });
        const result = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(result.error ?? `Failed to delete ${device.title || device.uuid}.`);
        }
      }

      const deletedUuids = new Set(deleteableDevices.map((device) => device.uuid));

      setDevices((currentDevices) => currentDevices.filter((device) => !deletedUuids.has(device.uuid)));
      setSelectedDeviceUuids((currentUuids) => currentUuids.filter((uuid) => !deletedUuids.has(uuid)));
      setSelectedForecastUuids((currentUuids) => currentUuids.filter((uuid) => !deletedUuids.has(uuid)));
      setDeviceCreatedAtByUuid((currentDates) => {
        const nextDates = { ...currentDates };

        deletedUuids.forEach((uuid) => {
          delete nextDates[uuid];
        });

        persistDeviceCreatedAtMap(nextDates);

        return nextDates;
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete Earnapp device.");
    } finally {
      setDeletingKey(null);
    }
  }

  const filteredDevices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return devices;
    }

    return devices.filter((device) =>
      [device.title, device.uuid, device.country, device.ips.join(" "), deviceCreatedAtByUuid[device.uuid] ?? "", isEarnAppDeviceActive(device) ? "active" : "offline", getSearchText(device)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [deviceCreatedAtByUuid, devices, query]);

  const forecastRows = useMemo<ForecastRow[]>(() => {
    return filteredDevices
      .map((device) => {
        const usage = getDeviceUsage(device);
        const pointsByDate = new Map<string, EarnAppUsagePoint>();

        usage?.points.forEach((point) => {
          pointsByDate.set(getDeviceDateKey(point.date), point);
        });

        const points = Array.from(pointsByDate.values()).slice(-14);
        const days = points.length;
        const totalUsage = points.reduce((total, point) => total + point.usage, 0);
        const totalEarned = points.reduce((total, point) => total + (point.earned || getUsageEarned(point.usage)), 0);
        const avgUsage = days ? totalUsage / days : 0;
        const avgEarned = days ? totalEarned / days : device.earned || getUsageEarned(device.uptime);

        return {
          device,
          days,
          avgUsage,
          avgEarned,
          sevenDayEarned: avgEarned * 7,
          thirtyDayEarned: avgEarned * 30,
        };
      })
      .sort((first, second) => second.thirtyDayEarned - first.thirtyDayEarned);
  }, [filteredDevices, getDeviceUsage]);

  const dailyForecastRows = useMemo<DailyForecastRow[]>(() => {
    return forecastRows
      .map((row) => {
        const usage = getDeviceUsage(row.device);
        const actualPoint = usage?.points.find((point) => getDeviceDateKey(point.date) === forecastDate) ?? null;
        const displayUsage = actualPoint ? actualPoint.usage : row.avgUsage;
        const displayEarned = actualPoint ? actualPoint.earned || getUsageEarned(actualPoint.usage) : row.avgEarned;

        return {
          ...row,
          actualPoint,
          displayUsage,
          displayEarned,
          hasNoUsage: displayUsage <= 0,
        };
      })
      .sort((first, second) => second.displayEarned - first.displayEarned);
  }, [forecastDate, forecastRows, getDeviceUsage]);

  const groupedDevices = useMemo<DeviceGroup[]>(() => {
    const groups = new Map<string, EarnAppDevice[]>();

    filteredDevices.forEach((device) => {
      const key = getDeviceGroupKey(device.title) || device.uuid || device.title;
      const currentDevices = groups.get(key) ?? [];

      currentDevices.push(device);
      groups.set(key, currentDevices);
    });

    return Array.from(groups.entries())
      .map(([key, groupDevices]) => {
        const groupForecastEarned = groupDevices.reduce((total, device) => {
          const row = forecastRows.find((forecastRow) => forecastRow.device.uuid === device.uuid);

          return total + (row?.thirtyDayEarned ?? 0);
        }, 0);

        return {
          key,
          label: getDeviceGroupLabel(groupDevices[0]),
          devices: groupDevices,
          activeCount: groupDevices.filter(isEarnAppDeviceActive).length,
          earned: groupDevices.reduce((total, device) => total + device.earned, 0),
          totalEarned: groupDevices.reduce((total, device) => total + device.earned_total, 0),
          forecastEarned: groupForecastEarned,
        };
      })
      .sort((first, second) => second.devices.length - first.devices.length || first.label.localeCompare(second.label));
  }, [filteredDevices, forecastRows]);

  const usageRows = useMemo<UsageRow[]>(() => {
    const rows: UsageRow[] = [];

    filteredDevices.forEach((device) => {
      const usage = getDeviceUsage(device);

      usage?.points.forEach((point) => {
        rows.push({
          key: `${device.uuid}-${point.date}`,
          device,
          point,
        });
      });
    });

    return rows.sort((first, second) => second.point.date.localeCompare(first.point.date));
  }, [filteredDevices, getDeviceUsage]);

  const watchlistRows = useMemo<WatchlistRow[]>(() => {
    return filteredDevices
      .map((device) => {
        const createdAtValue = deviceCreatedAtByUuid[device.uuid] ?? "";

        if (!createdAtValue) {
          return {
            device,
            createdAtValue,
            createdAt: null,
            deadlineAt: null,
            usage: 0,
            elapsed: 0,
            status: "missing" as WatchlistStatus,
          };
        }

        const createdAt = new Date(createdAtValue);

        if (Number.isNaN(createdAt.getTime())) {
          return {
            device,
            createdAtValue,
            createdAt: null,
            deadlineAt: null,
            usage: 0,
            elapsed: 0,
            status: "invalid" as WatchlistStatus,
          };
        }

        const deadlineAt = new Date(createdAt.getTime() + WATCHLIST_WINDOW_MS);
        const usage = getDeviceUsage(device)?.points.reduce((total, point) => {
          const pointKey = getDeviceDateKey(point.date);
          const createdAtKey = getDeviceDateKey(createdAt.toISOString());
          const deadlineKey = getDeviceDateKey(deadlineAt.toISOString());

          return pointKey >= createdAtKey && pointKey <= deadlineKey ? total + point.usage : total;
        }, 0) ?? 0;
        const elapsed = currentTime ? Math.max(0, currentTime - createdAt.getTime()) : 0;
        const status: WatchlistStatus =
          usage >= watchlistTargetUsageMs ? "passing" : currentTime && currentTime >= deadlineAt.getTime() ? "failed" : "pending";

        return {
          device,
          createdAtValue,
          createdAt,
          deadlineAt,
          usage,
          elapsed,
          status,
        };
      })
      .sort((first, second) => {
        const priority: Record<WatchlistStatus, number> = {
          failed: 0,
          pending: 1,
          missing: 2,
          invalid: 3,
          passing: 4,
        };

        return priority[first.status] - priority[second.status] || first.device.title.localeCompare(second.device.title);
      });
  }, [currentTime, deviceCreatedAtByUuid, filteredDevices, getDeviceUsage, watchlistTargetUsageMs]);

  const sortedGroupedDevices = useMemo(
    () =>
      sortRows(groupedDevices, sortConfig, "groups", (group, key) => {
        if (key === "label") return group.label;
        if (key === "devices") return group.devices.length;
        if (key === "active") return group.activeCount;
        if (key === "earned") return group.earned;
        if (key === "total") return group.totalEarned;
        if (key === "forecast") return group.forecastEarned;
        return "";
      }),
    [groupedDevices, sortConfig],
  );

  const sortedDevices = useMemo(
    () =>
      sortRows(filteredDevices, sortConfig, "devices", (device, key) => {
        if (key === "created") return deviceCreatedAtByUuid[device.uuid] ?? "";
        if (key === "device") return device.title;
        if (key === "status") return isEarnAppDeviceActive(device);
        if (key === "country") return device.country;
        if (key === "uptime") return device.uptime;
        if (key === "totalUptime") return device.total_uptime;
        if (key === "rate") return device.rate;
        if (key === "earned") return device.earned;
        if (key === "total") return device.earned_total;
        if (key === "ip") return device.ips[0] ?? "";
        return "";
      }),
    [deviceCreatedAtByUuid, filteredDevices, sortConfig],
  );

  const sortedDailyForecastRows = useMemo(
    () =>
      sortRows(dailyForecastRows, sortConfig, "forecast", (row, key) => {
        if (key === "created") return deviceCreatedAtByUuid[row.device.uuid] ?? "";
        if (key === "device") return row.device.title;
        if (key === "type") return row.actualPoint ? "actual" : "forecast";
        if (key === "usage") return row.displayUsage;
        if (key === "earned") return row.displayEarned;
        if (key === "days") return row.days;
        if (key === "sevenDay") return row.sevenDayEarned;
        if (key === "thirtyDay") return row.thirtyDayEarned;
        return "";
      }),
    [dailyForecastRows, deviceCreatedAtByUuid, sortConfig],
  );

  const sortedUsageRows = useMemo(
    () =>
      sortRows(usageRows, sortConfig, "usage", (row, key) => {
        if (key === "device") return row.device.title;
        if (key === "date") return row.point.date;
        if (key === "usage") return row.point.usage;
        if (key === "earned") return row.point.earned || getUsageEarned(row.point.usage);
        return "";
      }),
    [sortConfig, usageRows],
  );

  const sortedWatchlistRows = useMemo(
    () =>
      sortRows(watchlistRows, sortConfig, "watchlist", (row, key) => {
        if (key === "created") return row.createdAtValue;
        if (key === "device") return row.device.title;
        if (key === "status") return getWatchlistStatusLabel(row.status);
        if (key === "deadline") return row.deadlineAt;
        if (key === "elapsed") return row.elapsed;
        if (key === "usage") return row.usage;
        if (key === "target") return watchlistTargetUsageMs;
        return "";
      }),
    [sortConfig, watchlistRows, watchlistTargetUsageMs],
  );

  const selectedVisibleDeviceCount = filteredDevices.filter((device) => selectedDeviceUuids.includes(device.uuid)).length;
  const selectedDevices = devices.filter((device) => selectedDeviceUuids.includes(device.uuid));
  const activeCount = devices.filter(isEarnAppDeviceActive).length;
  const totalEarned = devices.reduce((total, device) => total + device.earned, 0);
  const forecastTotal = forecastRows.reduce((total, row) => total + row.thirtyDayEarned, 0);
  const dailyForecastTotal = dailyForecastRows.reduce((total, row) => total + row.displayEarned, 0);
  const noUsageForecastRows = dailyForecastRows.filter((row) => row.hasNoUsage && row.device.uuid);
  const selectedForecastDevices = noUsageForecastRows.map((row) => row.device).filter((device) => selectedForecastUuids.includes(device.uuid));
  const selectedVisibleForecastCount = noUsageForecastRows.filter((row) => selectedForecastUuids.includes(row.device.uuid)).length;
  const watchlistPassingCount = watchlistRows.filter((row) => row.status === "passing").length;
  const watchlistFailedCount = watchlistRows.filter((row) => row.status === "failed").length;
  const watchlistPendingCount = watchlistRows.filter((row) => row.status === "pending").length;
  const modalUsage = usageModalDevice ? getDeviceUsage(usageModalDevice) : null;
  const modalUsagePoints = modalUsage?.points.slice().sort((first, second) => second.date.localeCompare(first.date)) ?? [];

  return (
    <main className="page earnAppPage">
      <div className="shell">
        <header className="topbar">
          <div className="titleBlock">
            <h1>Earnapp Devices</h1>
            <p>Load Earnapp devices, review forecasts, and delete devices directly.</p>
          </div>
          <button className="refresh" type="button" onClick={() => void loadEarnappDevices()} disabled={loading || !activeCookie} aria-label="Refresh Earnapp devices">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="summary" aria-label="Earnapp summary">
          <div className="metric">
            <span>Total Devices</span>
            <strong>{devices.length}</strong>
          </div>
          <div className="metric positiveMetric">
            <span>Active</span>
            <strong>{activeCount}</strong>
          </div>
          <div className="metric negativeMetric">
            <span>Offline</span>
            <strong>{Math.max(0, devices.length - activeCount)}</strong>
          </div>
          <div className="metric">
            <span>Earned Now</span>
            <strong>{formatUsd(totalEarned)}</strong>
          </div>
          <div className="metric">
            <span>30 Day Forecast</span>
            <strong>{formatUsd(forecastTotal)}</strong>
          </div>
        </section>

        <section className="earnAppPanel" aria-label="Earnapp cookie loader">
          <div className="earnAppHeader">
            <div>
              <span>Earnapp API</span>
              <strong>{activeCookie && !editingCookie ? `Cookie saved, ${getSavedEarnAppCookieTimeLeft(savedCookieExpiresAt)}` : "Paste cookie or exported cookies JSON"}</strong>
            </div>
            <button className="loadConfig" type="button" onClick={() => void loadEarnappDevices()} disabled={loading || !activeCookie}>
              <RefreshCw size={17} />
              {loading ? "Loading..." : "Load Devices"}
            </button>
          </div>

          {editingCookie ? (
            <div className="earnAppCookieEditor">
              <label className="earnAppCookieField">
                <span>Cookie</span>
                <textarea value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder="cookie: xsrf-token=...; earnapp_session=..." aria-label="Earnapp cookie" />
              </label>
              <input
                ref={cookieFileInputRef}
                className="hiddenInput"
                type="file"
                accept=".json,.txt,text/plain,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void uploadCookieFile(file);
                  }

                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={createdAtFileInputRef}
                className="hiddenInput"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void uploadCreatedAtFile(file);
                  }

                  event.currentTarget.value = "";
                }}
              />
              <div className="earnAppCookieActions">
                <button className="secondaryButton" type="button" onClick={() => cookieFileInputRef.current?.click()}>
                  <FileUp size={17} />
                  Import Earnapp Cookie
                </button>
                <button className="loadConfig" type="button" onClick={saveCookie}>
                  <Save size={17} />
                  Save Cookie
                </button>
                <button className="secondaryButton" type="button" onClick={() => createdAtFileInputRef.current?.click()}>
                  <FileUp size={17} />
                  Import Created At
                </button>
                <button className="secondaryButton" type="button" onClick={exportCreatedAtFile}>
                  <Save size={17} />
                  Export Created At
                </button>
              </div>
            </div>
          ) : (
            <div className="earnAppCookieSaved">
              <div>
                <Check size={17} />
                <span>{getSavedEarnAppCookieTimeLeft(savedCookieExpiresAt)}</span>
              </div>
              <button className="secondaryButton" type="button" onClick={() => setEditingCookie(true)}>
                <Pencil size={16} />
                Edit
              </button>
              <input
                ref={createdAtFileInputRef}
                className="hiddenInput"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void uploadCreatedAtFile(file);
                  }

                  event.currentTarget.value = "";
                }}
              />
              <button className="secondaryButton" type="button" onClick={() => createdAtFileInputRef.current?.click()}>
                <FileUp size={16} />
                Import Created At
              </button>
              <button className="secondaryButton" type="button" onClick={exportCreatedAtFile}>
                <Save size={16} />
                Export Created At
              </button>
            </div>
          )}

          {error ? <p className="errorMessage">{error}</p> : null}
          <p className="quietText">Last devices check: {formatDate(checkedAt)} | Last usage check: {formatDate(usageCheckedAt)}</p>
        </section>

        <div className="toolbar">
          <label className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices" aria-label="Search Earnapp devices" />
            {query ? (
              <button type="button" className="clearSearch" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </label>
        </div>

        <div className="tabs" role="tablist" aria-label="Earnapp views">
          <button type="button" className={`tab ${tab === "groups" ? "active" : ""}`} onClick={() => setTab("groups")} aria-selected={tab === "groups"}>
            <Smartphone size={16} />
            <span>Groups {groupedDevices.length}</span>
          </button>
          <button type="button" className={`tab ${tab === "devices" ? "active" : ""}`} onClick={() => setTab("devices")} aria-selected={tab === "devices"}>
            <Smartphone size={16} />
            <span>Devices {filteredDevices.length}</span>
          </button>
          <button type="button" className={`tab ${tab === "forecast" ? "active" : ""}`} onClick={() => setTab("forecast")} aria-selected={tab === "forecast"}>
            <CalendarDays size={16} />
            <span>Forecast</span>
          </button>
          <button type="button" className={`tab ${tab === "watchlist" ? "active" : ""}`} onClick={() => setTab("watchlist")} aria-selected={tab === "watchlist"}>
            <Check size={16} />
            <span>Watchlist {watchlistFailedCount + watchlistPendingCount}</span>
          </button>
          <button type="button" className={`tab ${tab === "usage" ? "active" : ""}`} onClick={() => setTab("usage")} aria-selected={tab === "usage"}>
            <History size={16} />
            <span>Usage</span>
          </button>
        </div>

        {tab === "forecast" ? (
          <section className="earnAppSection" aria-label="Earnapp forecast">
            <div className="sectionHeader">
              <div>
                <h2>Daily Forecast</h2>
                <p>Calendar-selected device usage. Historical dates show actual usage when Earnapp has it; future dates show the per-day estimate.</p>
              </div>
              <label className="dateField">
                <CalendarDays size={16} />
                <span>Date</span>
                <input type="date" value={forecastDate} onChange={(event) => setForecastDate(event.target.value)} aria-label="Forecast date" />
              </label>
            </div>
            <div className="earnAppMetrics">
              <div>
                <span>Selected Date</span>
                <strong>{forecastDate}</strong>
              </div>
              <div>
                <span>Device Count</span>
                <strong>{dailyForecastRows.length}</strong>
              </div>
              <div>
                <span>Day Total</span>
                <strong>{formatUsd(dailyForecastTotal)}</strong>
              </div>
              <div>
                <span>Actual Rows</span>
                <strong>{dailyForecastRows.filter((row) => row.actualPoint).length}</strong>
              </div>
            </div>
            <div className="batchActions">
              <label className="selectionToggle">
                <input
                  type="checkbox"
                  checked={noUsageForecastRows.length > 0 && selectedVisibleForecastCount === noUsageForecastRows.length}
                  onChange={(event) =>
                    setSelectedForecastUuids(event.target.checked ? noUsageForecastRows.map((row) => row.device.uuid) : [])
                  }
                  disabled={noUsageForecastRows.length === 0}
                />
                <span>Select no-usage devices</span>
              </label>
              <div>
                <span>
                  {selectedForecastDevices.length} device{selectedForecastDevices.length === 1 ? "" : "s"} selected
                </span>
                <button
                  type="button"
                  className="loadConfig dangerButton"
                  onClick={() => void deleteDevices(selectedForecastDevices, `${selectedForecastDevices.length} no-usage forecast devices`)}
                  disabled={selectedForecastDevices.length === 0 || Boolean(deletingKey)}
                >
                  <Trash2 size={17} />
                  Delete Selected
                </button>
              </div>
            </div>
            <div className="tableWrap earnAppTable forecastTable">
              <table>
                <thead>
                  <tr>
                    <th>{renderSortHeader("Created", "created")}</th>
                    <th aria-label="Select no-usage forecast devices"></th>
                    <th>{renderSortHeader("Device", "device")}</th>
                    <th>{renderSortHeader("Type", "type")}</th>
                    <th>{renderSortHeader("Usage", "usage")}</th>
                    <th>{renderSortHeader("Earned", "earned")}</th>
                    <th>{renderSortHeader("Sample Days", "days")}</th>
                    <th>{renderSortHeader("7 Day Forecast", "sevenDay")}</th>
                    <th>{renderSortHeader("30 Day Forecast", "thirtyDay")}</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDailyForecastRows.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={10}>
                        Load devices and usage to see a forecast.
                      </td>
                    </tr>
                  ) : (
                    sortedDailyForecastRows.map((row) => (
                      <tr key={row.device.uuid || row.device.title}>
                        <td>
                          <button
                            type="button"
                            className={`iconButton createdAtButton ${deviceCreatedAtByUuid[row.device.uuid] ? "hasCreatedAt" : ""}`}
                            onClick={() => openCreatedAtModal(row.device)}
                            disabled={!row.device.uuid}
                            aria-label={`Set created at for ${row.device.title}`}
                            title={`Created at: ${formatCreatedAt(deviceCreatedAtByUuid[row.device.uuid])}`}
                          >
                            <CalendarDays size={16} />
                          </button>
                        </td>
                        <td>
                          {row.hasNoUsage ? (
                            <input
                              type="checkbox"
                              checked={selectedForecastUuids.includes(row.device.uuid)}
                              onChange={() =>
                                setSelectedForecastUuids((currentUuids) =>
                                  currentUuids.includes(row.device.uuid)
                                    ? currentUuids.filter((uuid) => uuid !== row.device.uuid)
                                    : [...currentUuids, row.device.uuid],
                                )
                              }
                              disabled={!row.device.uuid}
                              aria-label={`Select ${row.device.title}`}
                            />
                          ) : (
                            <span className="mutedDash">-</span>
                          )}
                        </td>
                        <td>
                          <div className="deviceName">
                            <strong>{row.device.title}</strong>
                            <span>{row.device.uuid || "-"}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`forecastBadge ${row.actualPoint ? "actual" : "estimated"}`}>{row.actualPoint ? "Actual" : "Forecast"}</span>
                        </td>
                        <td className="mono">{formatUsageDuration(row.displayUsage)}</td>
                        <td className="mono">{formatUsd(row.displayEarned)}</td>
                        <td className="mono">{row.days || "-"}</td>
                        <td className="mono">{formatUsd(row.sevenDayEarned)}</td>
                        <td className="mono">{formatUsd(row.thirtyDayEarned)}</td>
                        <td>
                          {row.hasNoUsage ? (
                            <button
                              type="button"
                              className="dangerIcon"
                              onClick={() => void deleteDevices([row.device])}
                              disabled={Boolean(deletingKey) || !row.device.uuid}
                              aria-label={`Delete ${row.device.title}`}
                              title="Delete device with no usage for selected date"
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <span className="mutedDash">-</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : tab === "watchlist" ? (
          <section className="earnAppSection" aria-label="Earnapp watchlist">
            <div className="sectionHeader">
              <div>
                <h2>Watchlist</h2>
                <p>Checks whether each install reached at least {formatUsageDuration(watchlistTargetUsageMs)} of usage during its first 6 hours after Created At.</p>
              </div>
              <div className="watchlistTargetField" aria-label="Watchlist target usage">
                <label>
                  <span>Hours</span>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="1"
                    value={watchlistTargetHoursDraft}
                    onChange={(event) => {
                      setWatchlistTargetHoursDraft(event.target.value);
                      saveWatchlistTargetUsageDraft(event.target.value, watchlistTargetMinutesDraft);
                    }}
                    onBlur={restoreWatchlistTargetDrafts}
                    aria-label="Watchlist target usage hours"
                  />
                </label>
                <label>
                  <span>Minutes</span>
                  <input
                    type="number"
                    min="0"
                    max="59"
                    step="1"
                    value={watchlistTargetMinutesDraft}
                    onChange={(event) => {
                      setWatchlistTargetMinutesDraft(event.target.value);
                      saveWatchlistTargetUsageDraft(watchlistTargetHoursDraft, event.target.value);
                    }}
                    onBlur={restoreWatchlistTargetDrafts}
                    aria-label="Watchlist target usage minutes"
                  />
                </label>
              </div>
            </div>
            <div className="earnAppMetrics">
              <div>
                <span>Passed</span>
                <strong>{watchlistPassingCount}</strong>
              </div>
              <div>
                <span>Pending</span>
                <strong>{watchlistPendingCount}</strong>
              </div>
              <div>
                <span>Failed</span>
                <strong>{watchlistFailedCount}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>{formatUsageDuration(watchlistTargetUsageMs)}</strong>
              </div>
            </div>
            <div className="tableWrap earnAppTable watchlistTable">
              <table>
                <thead>
                  <tr>
                    <th>{renderSortHeader("Created", "created")}</th>
                    <th>{renderSortHeader("Device", "device")}</th>
                    <th>{renderSortHeader("Status", "status")}</th>
                    <th>{renderSortHeader("Created At", "created")}</th>
                    <th>{renderSortHeader("6h Deadline", "deadline")}</th>
                    <th>{renderSortHeader("Elapsed", "elapsed")}</th>
                    <th>{renderSortHeader("First 6h Usage", "usage")}</th>
                    <th>{renderSortHeader("Target", "target")}</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedWatchlistRows.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={9}>
                        Paste a cookie and load devices.
                      </td>
                    </tr>
                  ) : (
                    sortedWatchlistRows.map((row) => (
                      <tr key={row.device.uuid || row.device.title}>
                        <td>
                          <button
                            type="button"
                            className={`iconButton createdAtButton ${row.createdAtValue ? "hasCreatedAt" : ""}`}
                            onClick={() => openCreatedAtModal(row.device)}
                            disabled={!row.device.uuid}
                            aria-label={`Set created at for ${row.device.title}`}
                            title={`Created at: ${formatCreatedAt(row.createdAtValue)}`}
                          >
                            <CalendarDays size={16} />
                          </button>
                        </td>
                        <td>
                          <div className="deviceName">
                            <strong>{row.device.title}</strong>
                            <span>{row.device.uuid || "-"}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`watchlistBadge ${row.status}`}>{getWatchlistStatusLabel(row.status)}</span>
                        </td>
                        <td className="mono">{formatCreatedAt(row.createdAtValue)}</td>
                        <td className="mono">{row.deadlineAt ? formatDate(row.deadlineAt.toISOString()) : "-"}</td>
                        <td className="mono">{row.createdAt ? formatUsageDuration(Math.min(row.elapsed, WATCHLIST_WINDOW_MS)) : "-"}</td>
                        <td className="mono">{formatUsageDuration(row.usage)}</td>
                        <td className="mono">{formatUsageDuration(watchlistTargetUsageMs)}</td>
                        <td>
                          <button
                            type="button"
                            className="dangerIcon"
                            onClick={() => void deleteDevices([row.device])}
                            disabled={Boolean(deletingKey) || !row.device.uuid}
                            aria-label={`Delete ${row.device.title}`}
                            title="Delete Earnapp device"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : tab === "usage" ? (
          <section className="earnAppSection" aria-label="Earnapp usage">
            <div className="tableWrap earnAppTable usageTable">
              <table>
                <thead>
                  <tr>
                    <th>{renderSortHeader("Device", "device")}</th>
                    <th>{renderSortHeader("Date", "date")}</th>
                    <th>{renderSortHeader("Usage", "usage")}</th>
                    <th>{renderSortHeader("Earned", "earned")}</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsageRows.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={5}>
                        No usage rows found.
                      </td>
                    </tr>
                  ) : (
                    sortedUsageRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <div className="deviceName">
                            <strong>{row.device.title}</strong>
                            <span>{row.device.uuid || "-"}</span>
                          </div>
                        </td>
                        <td>{formatShortDate(row.point.date)}</td>
                        <td className="mono">{formatUsageDuration(row.point.usage)}</td>
                        <td className="mono">{formatUsd(row.point.earned || getUsageEarned(row.point.usage))}</td>
                        <td>
                          <button
                            type="button"
                            className="dangerIcon"
                            onClick={() => void deleteDevices([row.device])}
                            disabled={Boolean(deletingKey) || !row.device.uuid}
                            aria-label={`Delete ${row.device.title}`}
                            title="Delete Earnapp device"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : tab === "groups" ? (
          <section className="earnAppSection" aria-label="Earnapp device groups">
            <div className="sectionHeader">
              <div>
                <h2>Groups</h2>
                <p>Devices with trailing numbers are grouped together, like dino1, dino2, and dino3 as dino.</p>
              </div>
            </div>
            <div className="groupSortBar" aria-label="Group sorting">
              {renderSortHeader("Group", "label")}
              {renderSortHeader("Devices", "devices")}
              {renderSortHeader("Active", "active")}
              {renderSortHeader("Earned", "earned")}
              {renderSortHeader("Total", "total")}
              {renderSortHeader("30 Day Forecast", "forecast")}
            </div>
            {sortedGroupedDevices.length === 0 ? (
              <div className="emptyPanel">{devices.length > 0 ? "No groups match your search." : "Paste a cookie and load devices."}</div>
            ) : (
              <div className="earnAppGroups">
                {sortedGroupedDevices.map((group) => {
                  const deletingGroup = group.devices.some((device) => device.uuid && deletingKey?.includes(device.uuid));

                  return (
                    <article className="earnAppGroup" key={group.key}>
                      <div className="earnAppGroupHeader">
                        <div>
                          <strong>{group.label}</strong>
                          <span title={group.devices.map((device) => device.title).join(", ")}>{group.devices.map((device) => device.title).join(", ")}</span>
                        </div>
                        <button
                          type="button"
                          className="dangerIcon"
                          onClick={() => void deleteDevices(group.devices, `${group.label} group (${group.devices.length} devices)`)}
                          disabled={Boolean(deletingKey) || group.devices.every((device) => !device.uuid)}
                          aria-label={`Delete ${group.label} group`}
                          title="Delete group"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <dl>
                        <div>
                          <dt>Devices</dt>
                          <dd>{group.devices.length}</dd>
                        </div>
                        <div>
                          <dt>Active</dt>
                          <dd>{group.activeCount}</dd>
                        </div>
                        <div>
                          <dt>Earned</dt>
                          <dd>{formatUsd(group.earned)}</dd>
                        </div>
                        <div>
                          <dt>Total</dt>
                          <dd>{formatUsd(group.totalEarned)}</dd>
                        </div>
                        <div>
                          <dt>30 Day Forecast</dt>
                          <dd>{formatUsd(group.forecastEarned)}</dd>
                        </div>
                        <div>
                          <dt>Status</dt>
                          <dd>{deletingGroup ? "Deleting" : "Ready"}</dd>
                        </div>
                      </dl>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="earnAppSection" aria-label="Earnapp devices">
            <div className="batchActions">
              <label className="selectionToggle">
                <input
                  type="checkbox"
                  checked={filteredDevices.length > 0 && selectedVisibleDeviceCount === filteredDevices.length}
                  onChange={(event) => setSelectedDeviceUuids(event.target.checked ? filteredDevices.map((device) => device.uuid).filter(Boolean) : [])}
                  disabled={filteredDevices.length === 0}
                />
                <span>Select visible</span>
              </label>
              <div>
                <span>
                  {selectedDeviceUuids.length} device{selectedDeviceUuids.length === 1 ? "" : "s"} selected
                </span>
                <button type="button" className="loadConfig dangerButton" onClick={() => void deleteDevices(selectedDevices)} disabled={selectedDeviceUuids.length === 0 || Boolean(deletingKey)}>
                  <Trash2 size={17} />
                  Delete Selected
                </button>
              </div>
            </div>
            <div className="tableWrap earnAppTable">
              <table>
                <thead>
                  <tr>
                    <th>{renderSortHeader("Created", "created")}</th>
                    <th aria-label="Select devices"></th>
                    <th aria-label="Usage history"></th>
                    <th>{renderSortHeader("Device", "device")}</th>
                    <th>{renderSortHeader("Status", "status")}</th>
                    <th>{renderSortHeader("Country", "country")}</th>
                    <th>{renderSortHeader("Uptime", "uptime")}</th>
                    <th>{renderSortHeader("Total Uptime", "totalUptime")}</th>
                    <th>{renderSortHeader("Rate", "rate")}</th>
                    <th>{renderSortHeader("Earned", "earned")}</th>
                    <th>{renderSortHeader("Total", "total")}</th>
                    <th>{renderSortHeader("IP", "ip")}</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && devices.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={13}>
                        Loading Earnapp devices...
                      </td>
                    </tr>
                  ) : filteredDevices.length === 0 ? (
                    <tr>
                      <td className="empty" colSpan={13}>
                        {devices.length > 0 ? "No devices match your search." : "Paste a cookie and load devices."}
                      </td>
                    </tr>
                  ) : (
                    sortedDevices.map((device, index) => {
                      const active = isEarnAppDeviceActive(device);
                      const usage = getDeviceUsage(device);

                      return (
                        <tr key={device.uuid || `${device.title}-${index}`}>
                          <td>
                            <button
                              type="button"
                              className={`iconButton createdAtButton ${deviceCreatedAtByUuid[device.uuid] ? "hasCreatedAt" : ""}`}
                              onClick={() => openCreatedAtModal(device)}
                              disabled={!device.uuid}
                              aria-label={`Set created at for ${device.title}`}
                              title={`Created at: ${formatCreatedAt(deviceCreatedAtByUuid[device.uuid])}`}
                            >
                              <CalendarDays size={16} />
                            </button>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedDeviceUuids.includes(device.uuid)}
                              onChange={() => toggleSelectedDevice(device)}
                              disabled={!device.uuid.trim()}
                              aria-label={`Select ${device.title}`}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`iconButton usageIconButton ${usage?.points.length ? "hasUsage" : ""}`}
                              onClick={() => setUsageModalDevice(device)}
                              aria-label={`View usage history for ${device.title}`}
                              title="View usage history"
                            >
                              <History size={16} />
                            </button>
                          </td>
                          <td>
                            <div className="deviceName">
                              <strong>{device.title}</strong>
                              <span>{device.uuid}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status ${active ? "online" : "offline"}`}>
                              <span className="dot" aria-hidden="true" />
                              {active ? "Active" : "Offline"}
                            </span>
                          </td>
                          <td>{device.country.toUpperCase() || "-"}</td>
                          <td className="mono">{formatUptime(device.uptime)}</td>
                          <td className="mono">{formatUptime(device.total_uptime)}</td>
                          <td className="mono">${device.rate}</td>
                          <td className="mono">{formatUsd(device.earned)}</td>
                          <td className="mono">{formatUsd(device.earned_total)}</td>
                          <td className="mono" title={device.ips.join(", ")}>
                            {device.ips[0] ?? "-"}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="dangerIcon"
                              onClick={() => void deleteDevices([device])}
                              disabled={Boolean(deletingKey) || !device.uuid}
                              aria-label={`Delete ${device.title}`}
                              title="Delete Earnapp device"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {usageModalDevice ? (
        <div className="toolModal" role="dialog" aria-modal="true" aria-label="Earnapp usage history">
          <button className="toolModalBackdrop" type="button" aria-label="Close usage history" onClick={() => setUsageModalDevice(null)} />
          <div className="toolDialog earnAppUsageDialog">
            <div className="toolModalBar">
              <div>
                <span>Usage History</span>
                <strong>{usageModalDevice.title || usageModalDevice.uuid}</strong>
              </div>
              <button type="button" aria-label="Close usage history" onClick={() => setUsageModalDevice(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="earnAppUsageBody">
              <div className="earnAppMetrics">
                <div>
                  <span>Total Usage</span>
                  <strong>{modalUsage ? formatUsageDuration(modalUsage.totalUsage) : "-"}</strong>
                </div>
                <div>
                  <span>Total Earned</span>
                  <strong>{modalUsage ? formatUsd(modalUsage.totalEarned || getUsageEarned(modalUsage.totalUsage)) : "-"}</strong>
                </div>
                <div>
                  <span>Daily Records</span>
                  <strong>{modalUsagePoints.length}</strong>
                </div>
              </div>

              {modalUsagePoints.length === 0 ? (
                <div className="emptyPanel">No usage records found for this device.</div>
              ) : (
                <div className="usageDailyGrid">
                  {modalUsagePoints.map((point) => (
                    <article className="usageDailyCard" key={`${usageModalDevice.uuid}-${point.date}`}>
                      <div>
                        <span>{formatShortDate(point.date)}</span>
                        <strong>{formatUsageDuration(point.usage)}</strong>
                      </div>
                      <dl>
                        <div>
                          <dt>Earned</dt>
                          <dd>{formatUsd(point.earned || getUsageEarned(point.usage))}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {createdAtModalDevice ? (
        <div className="toolModal" role="dialog" aria-modal="true" aria-label="Set created at">
          <button
            className="toolModalBackdrop"
            type="button"
            aria-label="Close created at editor"
            onClick={() => {
              setCreatedAtModalDevice(null);
              setCreatedAtDraft("");
            }}
          />
          <div className="toolDialog createdAtDialog">
            <div className="toolModalBar">
              <div>
                <span>Created At</span>
                <strong>{createdAtModalDevice.title || createdAtModalDevice.uuid}</strong>
              </div>
              <button
                type="button"
                aria-label="Close created at editor"
                onClick={() => {
                  setCreatedAtModalDevice(null);
                  setCreatedAtDraft("");
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="createdAtBody">
              <label className="createdAtField">
                <span>Date and Time</span>
                <input
                  type="datetime-local"
                  value={createdAtDraft}
                  onChange={(event) => setCreatedAtDraft(event.target.value)}
                  aria-label={`Created at for ${createdAtModalDevice.title || createdAtModalDevice.uuid}`}
                />
              </label>
              <div className="createdAtPreview">
                <span>Saved Value</span>
                <strong>{formatCreatedAt(deviceCreatedAtByUuid[createdAtModalDevice.uuid])}</strong>
              </div>
            </div>

            <div className="toolModalFooter">
              <button
                type="button"
                className="secondaryButton"
                onClick={() => {
                  saveDeviceCreatedAt(createdAtModalDevice, "");
                  setCreatedAtModalDevice(null);
                  setCreatedAtDraft("");
                }}
              >
                Clear
              </button>
              <button type="button" className="loadConfig" onClick={saveCreatedAtDraft}>
                <Save size={17} />
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
