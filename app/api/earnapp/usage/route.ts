import { NextResponse } from "next/server";
import { getCookieHeader, getEnvValue, getXsrfToken, toNumber, toRecord } from "@/lib/earnapp-api";

type EarnAppUsageRequest = {
  cookie?: unknown;
};

type UsagePoint = {
  date: string;
  usage: number;
  earned: number;
  raw: unknown;
};

type DeviceUsage = {
  uuid: string;
  title: string;
  totalUsage: number;
  totalEarned: number;
  points: UsagePoint[];
};

const EARNAPP_USAGE_URL = "https://earnapp.com/dashboard/api/usage";

function getString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function getNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const numberValue = toNumber(record[key]);

    if (numberValue) {
      return numberValue;
    }
  }

  return 0;
}

function normalizeDate(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return "";
}

function isDateKey(value: string) {
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value);
}

function normalizeUsagePoint(value: unknown, fallbackDate = ""): UsagePoint | null {
  if (Array.isArray(value)) {
    const date = normalizeDate(value[0]) || fallbackDate;

    if (!date) {
      return null;
    }

    return {
      date,
      usage: toNumber(value[1]),
      earned: toNumber(value[2]),
      raw: value,
    };
  }

  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const date = normalizeDate(getString(record, ["date", "day", "dt", "time", "timestamp", "created_at"]) || fallbackDate);

  if (!date) {
    return null;
  }

  return {
    date,
    usage: getNumber(record, ["usage", "used", "traffic", "bytes", "volume", "total", "value"]),
    earned: getNumber(record, ["earned", "earnings", "income", "revenue", "amount"]),
    raw: value,
  };
}

function addDeviceUsage(target: Map<string, DeviceUsage>, uuid: string, title: string, points: UsagePoint[]) {
  if (!uuid || points.length === 0) {
    return;
  }

  const existing = target.get(uuid) ?? {
    uuid,
    title,
    totalUsage: 0,
    totalEarned: 0,
    points: [],
  };

  existing.title ||= title;
  existing.points.push(...points);
  existing.points.sort((first, second) => first.date.localeCompare(second.date));
  existing.totalUsage = existing.points.reduce((total, point) => total + point.usage, 0);
  existing.totalEarned = existing.points.reduce((total, point) => total + point.earned, 0);
  target.set(uuid, existing);
}

function getNestedPoints(record: Record<string, unknown>) {
  for (const key of ["points", "usage", "history", "daily", "days", "items", "data"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function getDateKeyedPoints(record: Record<string, unknown>) {
  return Object.entries(record)
    .map(([date, value]) => {
      if (!isDateKey(date)) {
        return null;
      }

      if (typeof value === "number") {
        return normalizeUsagePoint([date, value]);
      }

      const pointRecord = toRecord(value);

      return pointRecord ? normalizeUsagePoint({ ...pointRecord, date }) : null;
    })
    .filter((point): point is UsagePoint => Boolean(point));
}

function getDateKeyedPointContainer(record: Record<string, unknown>) {
  for (const key of ["data", "usage", "history", "daily", "days"]) {
    const pointRecord = toRecord(record[key]);

    if (pointRecord && Object.keys(pointRecord).some(isDateKey)) {
      return pointRecord;
    }
  }

  return null;
}

function addDateDeviceMap(target: Map<string, DeviceUsage>, date: string, deviceMap: Record<string, unknown>) {
  Object.entries(deviceMap).forEach(([uuid, value]) => {
    if (typeof value === "number") {
      const point = normalizeUsagePoint([date, value]);

      addDeviceUsage(target, uuid, "", point ? [point] : []);
      return;
    }

    const record = toRecord(value);

    if (!record) {
      return;
    }

    const point = normalizeUsagePoint({ ...record, date });

    addDeviceUsage(target, uuid, getString(record, ["title", "name", "device", "device_name"]), point ? [point] : []);
  });
}

function addUsageContainer(target: Map<string, DeviceUsage>, container: Record<string, unknown>) {
  Object.entries(container).forEach(([uuid, value]) => {
    if (isDateKey(uuid)) {
      const deviceMap = toRecord(value);

      if (deviceMap) {
        addDateDeviceMap(target, uuid, deviceMap);
      }

      return;
    }

    if (Array.isArray(value)) {
      addDeviceUsage(
        target,
        uuid,
        "",
        value.map((point) => normalizeUsagePoint(point)).filter((point): point is UsagePoint => Boolean(point)),
      );
      return;
    }

    const record = toRecord(value);

    if (!record) {
      return;
    }

    const nestedPoints = getNestedPoints(record);
    const points =
      nestedPoints.length > 0
        ? nestedPoints.map((point) => normalizeUsagePoint(point)).filter((point): point is UsagePoint => Boolean(point))
        : getDateKeyedPointContainer(record)
          ? getDateKeyedPoints(getDateKeyedPointContainer(record) ?? {})
          : getDateKeyedPoints(record);

    addDeviceUsage(target, uuid, getString(record, ["title", "name", "device", "device_name"]), points);
  });
}

function normalizeUsage(data: unknown) {
  const usageByDevice = new Map<string, DeviceUsage>();
  const source = toRecord(data);
  const rows =
    Array.isArray(data) ? data : Array.isArray(source?.devices) ? source.devices : Array.isArray(source?.usage) ? source.usage : Array.isArray(source?.data) ? source.data : [];

  rows.forEach((row) => {
    const record = toRecord(row);

    if (!record) {
      return;
    }

    const uuid = getString(record, ["uuid", "_id", "device_uuid", "deviceId", "device_id", "id"]);
    const title = getString(record, ["title", "name", "device", "device_name"]);
    const nestedPoints = getNestedPoints(record);
    const dateKeyedPointContainer = getDateKeyedPointContainer(record);
    const points =
      nestedPoints.length > 0
        ? nestedPoints.map((point) => normalizeUsagePoint(point)).filter((point): point is UsagePoint => Boolean(point))
        : dateKeyedPointContainer
          ? getDateKeyedPoints(dateKeyedPointContainer)
          : getDateKeyedPoints(record);
    const directPoint = points.length === 0 ? normalizeUsagePoint(row) : null;

    addDeviceUsage(usageByDevice, uuid, title, directPoint ? [directPoint] : points);
  });

  if (source) {
    Object.entries(source).forEach(([uuid, value]) => {
      if (["devices", "usage", "data"].includes(uuid)) {
        const container = toRecord(value);

        if (container) {
          addUsageContainer(usageByDevice, container);
        }

        return;
      }

      if (isDateKey(uuid)) {
        const deviceMap = toRecord(value);

        if (deviceMap) {
          addDateDeviceMap(usageByDevice, uuid, deviceMap);
        }

        return;
      }

      if (Array.isArray(value)) {
        addDeviceUsage(
          usageByDevice,
          uuid,
          "",
          value.map((point) => normalizeUsagePoint(point)).filter((point): point is UsagePoint => Boolean(point)),
        );
      }
    });
  }

  return Object.fromEntries(usageByDevice.entries());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as EarnAppUsageRequest;
  const cookie = getCookieHeader(body.cookie);

  if (!cookie) {
    return NextResponse.json(
      { error: "Paste your Earnapp cookie header or exported cookies JSON before loading usage history." },
      { status: 400 },
    );
  }

  const xsrfToken = getXsrfToken(cookie);
  const appId = getEnvValue("EARNAPP_APP_ID") || "earnapp";
  const version = getEnvValue("EARNAPP_VERSION") || "1.634.431";
  const url = new URL(EARNAPP_USAGE_URL);

  url.searchParams.set("appid", appId);
  url.searchParams.set("version", version);
  url.searchParams.set("step", "daily");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        cookie,
        referer: "https://earnapp.com/dashboard/me/passive-income",
        "user-agent": getEnvValue("EARNAPP_USER_AGENT") || "Mozilla/5.0",
        "x-requested-with": "XMLHttpRequest",
        ...(xsrfToken ? { "xsrf-token": xsrfToken } : {}),
      },
    });
    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { error: `Earnapp returned ${response.status}: ${text.slice(0, 240) || response.statusText}` },
        { status: response.status },
      );
    }

    const data = JSON.parse(text) as unknown;
    const usageByDevice = normalizeUsage(data);

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      sourceCount: Object.keys(usageByDevice).length,
      usageByDevice,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Earnapp usage history.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
