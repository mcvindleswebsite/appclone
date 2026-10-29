import { espnGameUrl, espnPathFor } from "@/lib/bet/espn";
import { fotmobMatchUrl, fotmobTeams, fotmobTeamUrl } from "@/lib/bet/fotmob";

export const dynamic = "force-dynamic";

/**
 * GET ?m=<matchup>&t=<ISO kickoff>&k=<Kalshi ticker>: redirects to the game's live page.
 * US sports (by the ticker's series) go to ESPN; soccer goes to FotMob, falling back to the
 * first team's FotMob page. Only ever sends visitors to espn.com or fotmob.com.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const matchup = (params.get("m") ?? "").slice(0, 200);
  const kickoff = (params.get("t") ?? "").slice(0, 40);
  const espn = espnPathFor((params.get("k") ?? "").slice(0, 80));
  if (espn) {
    const url = await espnGameUrl(espn, matchup, kickoff);
    return Response.redirect(url ?? `https://www.espn.com/${espn.split("/")[1]}/scoreboard`, 302);
  }
  const team = fotmobTeams(matchup)[0];
  const url = (await fotmobMatchUrl(matchup, kickoff)) ?? (team ? await fotmobTeamUrl(team.slice(0, 80)) : null) ?? "https://www.fotmob.com";
  return Response.redirect(url, 302);
}
