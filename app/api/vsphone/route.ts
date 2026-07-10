import { createHash, createHmac } from "node:crypto";
import { NextResponse } from "next/server";

type VsPhoneAction = "replacement" | "userPadList";

type VsPhoneRequest = {
  action?: unknown;
  accessKey?: unknown;
  secretKey?: unknown;
  padCode?: unknown;
  equipmentIds?: unknown;
};

const VSPHONE_BASE_URL = "https://api.vsphone.com";
const PATHS: Record<VsPhoneAction, string> = {
  replacement: "/vsphone/api/padApi/replacement",
  userPadList: "/vsphone/api/padApi/userPadList",
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
    // api.vsphone.com expects the host-specific legacy format with the bare AK.
    // The credential scope remains part of StringToSign, but is not appended to Credential.
    authorization: `HMAC-SHA256 Credential=${accessKey}, SignedHeaders=${V4_SIGNED_HEADERS}, Signature=${signature}`,
  };
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

export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as VsPhoneRequest;
  const action = input.action === "replacement" || input.action === "userPadList" ? input.action : null;
  const accessKey = typeof input.accessKey === "string" ? input.accessKey.trim() : process.env.VSPHONE_ACCESS_KEY?.trim() ?? "";
  const secretKey = typeof input.secretKey === "string" ? input.secretKey.trim() : process.env.VSPHONE_SECRET_KEY?.trim() ?? "";

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
  const payload = action === "replacement" ? { padCode } : { padCode: padCode || null, equipmentIds };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha256").update(`${secretKey}${timestamp}${path}${body}`, "utf8").digest("hex");

  try {
    let authScheme = "V2";
    let response = await fetch(`${VSPHONE_BASE_URL}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Access-Key": accessKey,
        "X-Timestamp": timestamp,
        "X-Sign": signature,
      },
      body,
    });
    let data = await readResponse(response);

    if (needsV4Fallback(response, data)) {
      authScheme = "V4 fallback";
      response = await fetch(`${VSPHONE_BASE_URL}${path}`, {
        method: "POST",
        cache: "no-store",
        headers: getV4Headers(accessKey, secretKey, body),
        body,
      });
      data = await readResponse(response);
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
