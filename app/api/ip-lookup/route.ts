import { isIP } from "node:net";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ip?: unknown };
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";

  if (!isIP(ip)) return NextResponse.json({ error: "Enter a valid IPv4 or IPv6 address." }, { status: 400 });

  try {
    const ipinfoToken = process.env.IPINFO_TOKEN?.trim();
    const ip2LocationKey = process.env.IP2LOCATION_API_KEY?.trim();
    const dbIpKey = process.env.DBIP_API_KEY?.trim();
    const [response, intelligenceResponse, ipinfoResponse, ip2LocationResponse, dbIpResponse] = await Promise.all([
      fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { cache: "no-store" }),
      fetch(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}`, { cache: "no-store" }).catch(() => null),
      ipinfoToken ? fetch(`https://api.ipinfo.io/lookup/${encodeURIComponent(ip)}?token=${encodeURIComponent(ipinfoToken)}`, { cache: "no-store" }).catch(() => null) : null,
      ip2LocationKey ? fetch(`https://api.ip2location.io/?key=${encodeURIComponent(ip2LocationKey)}&ip=${encodeURIComponent(ip)}`, { cache: "no-store" }).catch(() => null) : null,
      dbIpKey ? fetch(`https://api.db-ip.com/v2/${encodeURIComponent(dbIpKey)}/${encodeURIComponent(ip)}`, { cache: "no-store" }).catch(() => null) : null,
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
    const ipinfo = ipinfoResponse?.ok ? await ipinfoResponse.json() as { is_hosting?: boolean; privacy?: { hosting?: boolean }; as?: { type?: string; name?: string } } : null;
    const ip2Location = ip2LocationResponse?.ok ? await ip2LocationResponse.json() as { usage_type?: string; usageType?: string; isp?: string } : null;
    const dbIp = dbIpResponse?.ok ? await dbIpResponse.json() as { usageType?: string; isp?: string; organization?: string } : null;
    const isp = result.connection?.isp || "Unknown";
    const dataCenterKeywords = /amazon|aws|google cloud|microsoft|azure|digitalocean|linode|akamai|ovh|hetzner|vultr|oracle cloud|alibaba cloud|tencent cloud|cloudflare|hosting|data ?center|datacentre|server|colocation/i;
    const sources: Array<{ provider: string; verdict: boolean | null }> = [
      { provider: "ipapi.is", verdict: typeof intelligence?.is_datacenter === "boolean" ? intelligence.is_datacenter : null },
      { provider: "IPWhois", verdict: typeof result.security?.hosting === "boolean" ? result.security.hosting : null },
      { provider: "IPinfo", verdict: typeof ipinfo?.is_hosting === "boolean" ? ipinfo.is_hosting : typeof ipinfo?.privacy?.hosting === "boolean" ? ipinfo.privacy.hosting : ipinfo ? ipinfo.as?.type === "hosting" : null },
      { provider: "IP2Location", verdict: ip2Location ? /hosting|data ?center|content delivery/i.test(ip2Location.usage_type || ip2Location.usageType || "") : null },
      { provider: "DB-IP", verdict: dbIp ? (dbIp.usageType === "hosting" ? true : ["consumer", "corporate"].includes(dbIp.usageType || "") ? false : null) : null },
    ];
    const availableVerdicts = sources.map((source) => source.verdict).filter((value): value is boolean => typeof value === "boolean");
    const isDataCenter = availableVerdicts.length > 0 ? availableVerdicts.includes(true) : dataCenterKeywords.test(isp);
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
        ? "multi-source consensus"
        : availableVerdicts.length > 0 ? "multi-source consensus" : "ISP heuristic",
      sources,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to look up IP information." }, { status: 502 });
  }
}
