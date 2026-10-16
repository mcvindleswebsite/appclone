import { profile } from "@/data/profile";

import type { ViewConfig, ViewId } from "./types";

export const VIEW_CONFIG: Record<ViewId, ViewConfig> = {
  home: { title: profile.name, split: true },
  games: { title: "Games", split: true },
  music: { title: "Music", split: false },
  nowPlaying: { title: "Now Playing", split: false },
  brickGame: { title: "Brick", split: false, disableLongPress: true },
  solitaireGame: { title: "Solitaire", split: false, disableLongPress: true },
};
