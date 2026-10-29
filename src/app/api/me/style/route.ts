import { meRoute } from "@/lib/me/handler";
import { rebuildStyle } from "@/lib/me/style";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Rebuilds the style guide from every example. */
export async function POST(request: Request) {
  return meRoute(request, async () => Response.json({ profile: await rebuildStyle() }));
}
