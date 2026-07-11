import { isIP } from "node:net";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ip?: unknown };
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";

  if (!isIP(ip)) return NextResponse.json({ error: "Enter a valid IPv4 or IPv6 address." }, { status: 400 });

  try {
    const [response, intelligenceResponse] = await Promise.all([
      fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { cache: "no-store" }),
      fetch(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, { cache: "no-store" }).catch(() => null),
    ]);
    const result = await response.json() as {
      success?: boolean;
      message?: string;
      city?: string;
      region?: string;
      country?: string;
      connection?: { isp?: string };
      security?: { hosting?: boolean };
    };

    if (!response.ok || result.success === false) {
      return NextResponse.json({ error: result.message || "IP information was not found." }, { status: 502 });
    }

    const intelligence = intelligenceResponse?.ok ? await intelligenceResponse.json() as {
      is_datacenter?: boolean;
      datacenter?: { datacenter?: string; domain?: string };
      company?: { name?: string; type?: string };
    } : null;
    const isp = result.connection?.isp || "Unknown";
    const dataCenterKeywords = /amazon|aws|google cloud|microsoft|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|oracle cloud|alibaba cloud|tencent cloud|cloudflare|hosting|data ?center|datacentre|server|colocation/i;
    const isDataCenter = typeof intelligence?.is_datacenter === "boolean"
      ? intelligence.is_datacenter
      : typeof result.security?.hosting === "boolean"
        ? result.security.hosting
        : dataCenterKeywords.test(isp);
    const dataCenterService = isDataCenter
      ? intelligence?.datacenter?.datacenter || intelligence?.company?.name || intelligence?.datacenter?.domain || isp
      : "Not detected";

    return NextResponse.json({
      ip,
      isp,
      city: result.city || "Unknown",
      region: result.region || "Unknown",
      country: result.country || "Unknown",
      isDataCenter,
      dataCenterService,
      classificationSource: typeof intelligence?.is_datacenter === "boolean"
        ? "ipapi.is hosting intelligence"
        : typeof result.security?.hosting === "boolean" ? "provider" : "ISP heuristic",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to look up IP information." }, { status: 502 });
  }
}
