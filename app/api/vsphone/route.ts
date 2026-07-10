import { createHash } from "node:crypto";
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
    const response = await fetch(`${VSPHONE_BASE_URL}${path}`, {
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
    const responseText = await response.text();
    let data: unknown = responseText;

    try {
      data = JSON.parse(responseText);
    } catch {
      // Preserve non-JSON upstream responses for troubleshooting.
    }

    return NextResponse.json(
      {
        ok: response.ok,
        action,
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
