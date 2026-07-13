import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";

type VsPhoneAction = "replacement" | "userPadList" | "checkIP" | "infos" | "screenshotGallery";

type VsPhoneRequest = {
  action?: unknown;
  accessKey?: unknown;
  secretKey?: unknown;
  padCode?: unknown;
  equipmentIds?: unknown;
  proxy?: unknown;
  infos?: unknown;
};

const VSPHONE_BASE_URL = "https://api.vsphone.com";
const PATHS: Record<VsPhoneAction, string> = {
  replacement: "/vsphone/api/padApi/replacement",
  userPadList: "/vsphone/api/padApi/userPadList",
  checkIP: "/vsphone/api/padApi/checkIP",
  infos: "/vsphone/api/padApi/infos",
  screenshotGallery: "/vsphone/api/padApi/infos",
};

const V4_HOST = "api.vsphone.com";
const V4_CONTENT_TYPE = "application/json;charset=UTF-8";
const V4_SERVICE = "armcloud-paas";
const V4_SIGNED_HEADERS = "content-type;host;x-content-sha256;x-date";

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function getV4Headers(accessKey: string, secretKey: string, body: string) {
  const xDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = xDate.slice(0, 8);
  const credentialScope = `${shortDate}/${V4_SERVICE}/request`;
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const canonicalRequest = [
    `host:${V4_HOST}`,
    `x-date:${xDate}`,
    `content-type:${V4_CONTENT_TYPE}`,
    `signedHeaders:${V4_SIGNED_HEADERS}`,
    `x-content-sha256:${bodyHash}`,
  ].join("\n");
  const stringToSign = [
    "HMAC-SHA256",
    xDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(secretKey, shortDate), V4_SERVICE), "request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    "content-type": V4_CONTENT_TYPE,
    "x-date": xDate,
    "x-host": V4_HOST,
    authorization: `HMAC-SHA256 Credential=${accessKey}, SignedHeaders=${V4_SIGNED_HEADERS}, Signature=${signature}`,
  };
}

function getCookie(request: Request, name: string) {
  const item = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

async function readResponse(response: Response) {
  const responseText = await response.text();

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return responseText;
  }
}

function needsV4Fallback(response: Response, data: unknown) {
  if (response.status !== 401 || !data || typeof data !== "object") return false;

  const result = data as { code?: unknown; msg?: unknown };
  return result.code === 2032 && typeof result.msg === "string" && result.msg.toLowerCase().includes("authorization");
}

async function callVsPhone(path: string, payload: unknown, accessKey: string, secretKey: string) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha256").update(`${secretKey}${timestamp}${path}${body}`, "utf8").digest("hex");
  let authScheme = "V2";
  let response = await fetch(`${VSPHONE_BASE_URL}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Access-Key": accessKey, "X-Timestamp": timestamp, "X-Sign": signature },
    body,
  });
  let data = await readResponse(response);

  if (needsV4Fallback(response, data)) {
    authScheme = "V4 Java-compatible";
    response = await fetch(`${VSPHONE_BASE_URL}${path}`, { method: "POST", cache: "no-store", headers: getV4Headers(accessKey, secretKey, body), body });
    data = await readResponse(response);
  }

  return { response, data, authScheme };
}

export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as VsPhoneRequest;
  const action = input.action === "replacement" || input.action === "userPadList" || input.action === "checkIP" || input.action === "infos" || input.action === "screenshotGallery" ? input.action : null;
  const enteredAccessKey = typeof input.accessKey === "string" ? input.accessKey.trim() : "";
  const enteredSecretKey = typeof input.secretKey === "string" ? input.secretKey.trim() : "";
  const accessKey = enteredAccessKey || getCookie(request, "vsphone-ak") || process.env.VSPHONE_ACCESS_KEY?.trim() || "";
  const secretKey = enteredSecretKey || getCookie(request, "vsphone-sk") || process.env.VSPHONE_SECRET_KEY?.trim() || "";

  if (!action) {
    return NextResponse.json({ error: "Select a supported VSPhone request." }, { status: 400 });
  }

  if (!accessKey || !secretKey) {
    return NextResponse.json({ error: "VSPhone Access Key and Secret Key are required." }, { status: 400 });
  }

  const padCode = typeof input.padCode === "string" ? input.padCode.trim() : "";
  const equipmentIds = Array.isArray(input.equipmentIds)
    ? input.equipmentIds.filter((value): value is number => typeof value === "number" && Number.isInteger(value))
    : [];

  if (action === "replacement" && !padCode) {
    return NextResponse.json({ error: "A pad code is required for device replacement." }, { status: 400 });
  }

  const path = PATHS[action];
  const payload: Record<string, string | number | number[] | string[]> = {};

  if ((action === "replacement" || action === "userPadList") && padCode) payload.padCode = padCode;
  if (action === "userPadList" && equipmentIds.length > 0) payload.equipmentIds = equipmentIds;

  if (action === "checkIP") {
    const proxy = input.proxy && typeof input.proxy === "object" ? input.proxy as Record<string, unknown> : {};
    const requiredStrings = ["host", "account", "password", "type"] as const;
    const port = typeof proxy.port === "number" ? proxy.port : Number(proxy.port);

    for (const key of requiredStrings) {
      const value = typeof proxy[key] === "string" ? proxy[key].trim() : "";
      if (!value) return NextResponse.json({ error: `${key} is required for IP checking.` }, { status: 400 });
      payload[key] = value;
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: "A valid proxy port is required for IP checking." }, { status: 400 });
    }
    payload.port = port;

    for (const key of ["country", "ip", "loc", "city", "region", "timezone"] as const) {
      const value = typeof proxy[key] === "string" ? proxy[key].trim() : "";
      if (value) payload[key] = value;
    }
  }

  if (action === "infos" || action === "screenshotGallery") {
    const infos = input.infos && typeof input.infos === "object" ? input.infos as Record<string, unknown> : {};
    const page = Number(infos.page);
    const rows = Number(infos.rows);

    if (!Number.isInteger(page) || page < 1) return NextResponse.json({ error: "Page must be a positive integer." }, { status: 400 });
    if (!Number.isInteger(rows) || rows < 1) return NextResponse.json({ error: "Rows must be a positive integer." }, { status: 400 });

    payload.page = page;
    payload.rows = rows;

    if (infos.padType === "virtual" || infos.padType === "real") payload.padType = infos.padType;
    if (Array.isArray(infos.padCodes)) {
      const padCodes = infos.padCodes.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim());
      if (padCodes.length > 0) payload.padCodes = padCodes;
    }
  }
  try {
    const initialRequest = await callVsPhone(path, payload, accessKey, secretKey);
    let { response, data, authScheme } = initialRequest;

    if (action === "screenshotGallery" && response.ok) {
      const infosData = data && typeof data === "object" && "data" in data ? data.data : null;
      const pageData = infosData && typeof infosData === "object" && "pageData" in infosData && Array.isArray(infosData.pageData) ? infosData.pageData : [];
      const devices = pageData.flatMap((item) => {
        if (!item || typeof item !== "object" || !("padCode" in item) || typeof item.padCode !== "string") return [];
        const name = "padName" in item && typeof item.padName === "string" && item.padName ? item.padName : "remark" in item && typeof item.remark === "string" && item.remark ? item.remark : item.padCode;
        return [{ padCode: item.padCode, name }];
      });
      const screenshotPath = "/vsphone/api/padApi/getLongGenerateUrl";
      const screenshotRequest = await callVsPhone(screenshotPath, { padCodes: devices.map((device) => device.padCode), format: "png" }, accessKey, secretKey);
      const screenshotData = screenshotRequest.data && typeof screenshotRequest.data === "object" && "data" in screenshotRequest.data && Array.isArray(screenshotRequest.data.data) ? screenshotRequest.data.data : [];
      const urls = new Map(screenshotData.flatMap((item) => item && typeof item === "object" && "padCode" in item && "url" in item && typeof item.padCode === "string" && typeof item.url === "string" ? [[item.padCode, item.url] as const] : []));

      response = screenshotRequest.response;
      authScheme = screenshotRequest.authScheme;
      data = { msg: response.ok ? "success" : "Screenshot request failed", code: response.status, data: devices.map((device) => ({ ...device, url: urls.get(device.padCode) || "" })) };
    }

    const upstreamMessage = data && typeof data === "object" && "msg" in data && typeof data.msg === "string" ? data.msg : "";

    return NextResponse.json(
      {
        ok: response.ok,
        ...(response.ok ? {} : { error: upstreamMessage || `VSPhone request failed with status ${response.status}.` }),
        action,
        authScheme,
        method: "POST",
        path,
        requestedAt: new Date().toISOString(),
        status: response.status,
        data,
      },
      { status: response.ok ? 200 : response.status },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to call VSPhone." },
      { status: 502 },
    );
  }
}
