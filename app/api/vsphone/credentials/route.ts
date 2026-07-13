import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

type CredentialConfig = { id: string; name: string; accessKey: string; secretKey: string };

const CONFIGS_COOKIE = "vsphone-configs";
const ACTIVE_COOKIE = "vsphone-active-config";
const COOKIE_OPTIONS = "Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000";

function getCookie(request: Request, name: string) {
  const item = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function getConfigs(request: Request): CredentialConfig[] {
  try {
    const encoded = getCookie(request, CONFIGS_COOKIE);
    if (!encoded) return [];
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is CredentialConfig => Boolean(item && typeof item === "object" && "id" in item && "name" in item && "accessKey" in item && "secretKey" in item)) : [];
  } catch {
    return [];
  }
}

function setCookies(response: NextResponse, configs: CredentialConfig[], activeId: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const encoded = Buffer.from(JSON.stringify(configs), "utf8").toString("base64url");
  response.headers.append("Set-Cookie", `${CONFIGS_COOKIE}=${encoded}; ${COOKIE_OPTIONS}${secure}`);
  response.headers.append("Set-Cookie", `${ACTIVE_COOKIE}=${encodeURIComponent(activeId)}; ${COOKIE_OPTIONS}${secure}`);
}

function publicResult(configs: CredentialConfig[], activeId: string) {
  return { saved: configs.length > 0, activeId, configs: configs.map(({ id, name }) => ({ id, name })) };
}

export async function GET(request: Request) {
  const configs = getConfigs(request);
  const requestedActiveId = getCookie(request, ACTIVE_COOKIE);
  const activeId = configs.some((config) => config.id === requestedActiveId) ? requestedActiveId : configs[0]?.id || "";
  return NextResponse.json(publicResult(configs, activeId));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; name?: unknown; accessKey?: unknown; secretKey?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const accessKey = typeof body.accessKey === "string" ? body.accessKey.trim() : "";
  const secretKey = typeof body.secretKey === "string" ? body.secretKey.trim() : "";
  const configs = getConfigs(request);
  const existingIndex = configs.findIndex((config) => config.id === id);

  if (!name) return NextResponse.json({ error: "A configuration name is required." }, { status: 400 });
  if (configs.some((config, index) => config.name.toLowerCase() === name.toLowerCase() && index !== existingIndex)) {
    return NextResponse.json({ error: "A configuration with that name already exists." }, { status: 409 });
  }

  let activeId = id;
  if (existingIndex >= 0) {
    const existing = configs[existingIndex];
    configs[existingIndex] = { ...existing, name, accessKey: accessKey || existing.accessKey, secretKey: secretKey || existing.secretKey };
  } else {
    if (!accessKey || !secretKey) return NextResponse.json({ error: "Access Key and Secret Key are required for a new configuration." }, { status: 400 });
    activeId = randomUUID();
    configs.push({ id: activeId, name, accessKey, secretKey });
  }

  const response = NextResponse.json(publicResult(configs, activeId));
  setCookies(response, configs, activeId);
  return response;
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const configs = getConfigs(request);
  if (!configs.some((config) => config.id === id)) return NextResponse.json({ error: "Configuration not found." }, { status: 404 });

  const response = NextResponse.json(publicResult(configs, id));
  setCookies(response, configs, id);
  return response;
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const configs = getConfigs(request).filter((config) => config.id !== id);
  const activeId = configs[0]?.id || "";
  const response = NextResponse.json(publicResult(configs, activeId));
  setCookies(response, configs, activeId);
  return response;
}
