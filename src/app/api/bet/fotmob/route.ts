import { fotmobMatchUrl, fotmobTeams, fotmobTeamUrl } from "@/lib/bet/fotmob";

export const dynamic = "force-dynamic";

/**
 * GET ?m=<matchup>&t=<ISO kickoff>: redirects to the game on FotMob for live updates, or to
 * the first team's page (then FotMob's home) when the match isn't listed. Only ever sends
 * visitors to fotmob.com.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const matchup = (params.get("m") ?? "").slice(0, 200);
  const kickoff = (params.get("t") ?? "").slice(0, 40);
  const url =
    (await fotmobMatchUrl(matchup, kickoff)) ??
    (fotmobTeams(matchup)[0] ? await fotmobTeamUrl(fotmobTeams(matchup)[0].slice(0, 80)) : null) ??
    "https://www.fotmob.com";
  return Response.redirect(url, 302);
}
