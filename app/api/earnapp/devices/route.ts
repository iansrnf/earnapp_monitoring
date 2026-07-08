import { NextResponse } from "next/server";
import { getCookieHeader, getEnvValue, getXsrfToken, toNumber } from "@/lib/earnapp-api";

type EarnAppDevice = {
  [key: string]: unknown;
  uuid?: unknown;
  title?: unknown;
  rate?: unknown;
  earned?: unknown;
  earned_total?: unknown;
  country?: unknown;
  ips?: unknown;
  billing?: unknown;
  uptime?: unknown;
  total_uptime?: unknown;
};

type EarnAppDevicesRequest = {
  cookie?: unknown;
};

const EARNAPP_DEVICES_URL = "https://earnapp.com/dashboard/api/devices";

function normalizeEarnAppDevice(device: EarnAppDevice) {
  return {
    ...device,
    uuid: typeof device.uuid === "string" ? device.uuid : "",
    title: typeof device.title === "string" ? device.title : "Unnamed device",
    rate: toNumber(device.rate),
    earned: toNumber(device.earned),
    earned_total: toNumber(device.earned_total),
    country: typeof device.country === "string" ? device.country : "",
    ips: Array.isArray(device.ips) ? device.ips.filter((ip): ip is string => typeof ip === "string") : [],
    billing: typeof device.billing === "string" ? device.billing : "",
    uptime: toNumber(device.uptime),
    total_uptime: toNumber(device.total_uptime),
    raw: device,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as EarnAppDevicesRequest;
  const cookie = getCookieHeader(body.cookie);

  if (!cookie) {
    return NextResponse.json(
      { error: "Paste your Earnapp cookie header or exported cookies JSON before loading devices." },
      { status: 400 },
    );
  }

  const xsrfToken = getXsrfToken(cookie);
  const appId = getEnvValue("EARNAPP_APP_ID") || "earnapp";
  const version = getEnvValue("EARNAPP_VERSION") || "1.634.431";
  const url = new URL(EARNAPP_DEVICES_URL);

  url.searchParams.set("appid", appId);
  url.searchParams.set("version", version);

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

    if (!Array.isArray(data)) {
      return NextResponse.json({ error: "Earnapp returned an unexpected devices response." }, { status: 502 });
    }

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      sourceCount: data.length,
      devices: data.map((device) => normalizeEarnAppDevice(device as EarnAppDevice)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Earnapp devices.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
