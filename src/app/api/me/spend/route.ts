import { meRoute } from "@/lib/me/handler";
import { readSpend } from "@/lib/me/store";

export const dynamic = "force-dynamic";

/** What /me's AI calls have cost this month (UTC), by its own count from each response's usage. */
export async function GET(request: Request) {
  return meRoute(request, async () => Response.json(await readSpend()));
}
