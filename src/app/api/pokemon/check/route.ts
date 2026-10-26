import type { NextRequest } from "next/server";

import type { CheckResult, StockState } from "@/types/pokemon";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

/** Rejects anything that isn't a public http(s) hostname, so this can't be used to probe internal hosts. */
const parseTarget = (raw: string | null) => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[");
    const isInternal =
      host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".");
    return isIpLiteral || isInternal ? null : url;
  } catch {
    return null;
  }
};

const detectStock = (status: number, html: string): StockState => {
  const text = html.toLowerCase();
  if (status === 403 || status === 429 || text.includes("incapsula") || text.includes("captcha")) {
    return "blocked";
  }
  if (text.includes("queue-it") || text.includes("waiting room") || text.includes("you are now in line")) {
    return "queue";
  }
  if (/sold out|out of stock|currently unavailable/.test(text)) return "sold_out";
  if (/add to cart|add to bag|buy now/.test(text)) return "in_stock";
  return "unknown";
};

export async function GET(request: NextRequest) {
  const target = parseTarget(request.nextUrl.searchParams.get("url"));
  if (!target) {
    return Response.json({ error: "Invalid target URL" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const response = await fetch(target, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await response.text();
    const result: CheckResult = {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      stock: detectStock(response.status, html),
    };
    return Response.json(result);
  } catch (error) {
    const result: CheckResult = {
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      stock: "unknown",
      error: error instanceof Error && error.name === "TimeoutError" ? "Timed out" : "Network error",
    };
    return Response.json(result);
  }
}
