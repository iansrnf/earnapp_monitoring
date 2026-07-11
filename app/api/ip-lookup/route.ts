import { isIP } from "node:net";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ip?: unknown };
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";

  if (!isIP(ip)) return NextResponse.json({ error: "Enter a valid IPv4 or IPv6 address." }, { status: 400 });

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { cache: "no-store" });
    const result = await response.json() as {
      success?: boolean;
      message?: string;
      city?: string;
      region?: string;
      country?: string;
      connection?: { isp?: string };
    };

    if (!response.ok || result.success === false) {
      return NextResponse.json({ error: result.message || "IP information was not found." }, { status: 502 });
    }

    return NextResponse.json({
      ip,
      isp: result.connection?.isp || "Unknown",
      city: result.city || "Unknown",
      region: result.region || "Unknown",
      country: result.country || "Unknown",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to look up IP information." }, { status: 502 });
  }
}
