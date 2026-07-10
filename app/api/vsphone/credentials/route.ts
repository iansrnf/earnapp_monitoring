import { NextResponse } from "next/server";

const COOKIE_OPTIONS = "Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000";

function hasCookie(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").some((value) => value.trim().startsWith(`${name}=`)) ?? false;
}

export async function GET(request: Request) {
  return NextResponse.json({ saved: hasCookie(request, "vsphone-ak") && hasCookie(request, "vsphone-sk") });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { accessKey?: unknown; secretKey?: unknown };
  const accessKey = typeof body.accessKey === "string" ? body.accessKey.trim() : "";
  const secretKey = typeof body.secretKey === "string" ? body.secretKey.trim() : "";

  if (!accessKey || !secretKey) {
    return NextResponse.json({ error: "Access Key and Secret Key are required." }, { status: 400 });
  }

  const response = NextResponse.json({ saved: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append("Set-Cookie", `vsphone-ak=${encodeURIComponent(accessKey)}; ${COOKIE_OPTIONS}${secure}`);
  response.headers.append("Set-Cookie", `vsphone-sk=${encodeURIComponent(secretKey)}; ${COOKIE_OPTIONS}${secure}`);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ saved: false });
  response.headers.append("Set-Cookie", "vsphone-ak=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  response.headers.append("Set-Cookie", "vsphone-sk=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  return response;
}
