import { NextResponse } from "next/server";
import { getCookieHeader, getEnvValue, getXsrfToken } from "@/lib/earnapp-api";

type RouteContext = {
  params: Promise<{
    uuid: string;
  }>;
};

type EarnAppDeviceRequest = {
  cookie?: unknown;
};

const EARNAPP_DEVICE_URL = "https://earnapp.com/dashboard/api/device";

export async function DELETE(request: Request, context: RouteContext) {
  const { uuid } = await context.params;
  const body = (await request.json().catch(() => ({}))) as EarnAppDeviceRequest;
  const cookie = getCookieHeader(body.cookie);

  if (!uuid.trim()) {
    return NextResponse.json({ error: "Missing Earnapp device UUID." }, { status: 400 });
  }

  if (!cookie) {
    return NextResponse.json(
      { error: "Paste your Earnapp cookie header or exported cookies JSON before deleting a device." },
      { status: 400 },
    );
  }

  const xsrfToken = getXsrfToken(cookie);
  const appId = getEnvValue("EARNAPP_APP_ID") || "earnapp";
  const version = getEnvValue("EARNAPP_VERSION") || "1.634.431";
  const url = new URL(`${EARNAPP_DEVICE_URL}/${encodeURIComponent(uuid)}`);

  url.searchParams.set("appid", appId);
  url.searchParams.set("version", version);

  try {
    const response = await fetch(url, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        cookie,
        origin: "https://earnapp.com",
        referer: "https://earnapp.com/dashboard/me/passive-income",
        "user-agent": getEnvValue("EARNAPP_USER_AGENT") || "Mozilla/5.0",
        "x-requested-with": "XMLHttpRequest",
        ...(xsrfToken ? { "xsrf-token": xsrfToken } : {}),
      },
    });
    const text = await response.text();
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Earnapp returned ${response.status}: ${text.slice(0, 240) || response.statusText}` },
        { status: response.status },
      );
    }

    return NextResponse.json({ ok: true, response: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete Earnapp device.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
