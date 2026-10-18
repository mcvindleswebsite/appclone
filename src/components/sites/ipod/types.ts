import type { FavoriteSong } from "@/data/favorite-songs";

/** `link-<n>` previews the nth entry of `profile.links`. */
export type PreviewId = "music" | "games" | "nowPlaying" | `link-${number}`;

export type ViewId =
  | "home"
  | "music"
  | "games"
  | "nowPlaying"
  | "brickGame"
  | "solitaireGame"
  | "blackjackGame"
  | "about";

type SharedOptionProps = {
  label: string;
  sublabel?: string;
  imageUrl?: string;
  /** Circular avatar shown before the label, falling back to initials. */
  avatarUrl?: string;
  preview?: PreviewId;
};

export type ListOption = SharedOptionProps &
  (
    | { type: "view"; viewId: ViewId }
    | { type: "link"; url: string }
    | {
        type: "song";
        queue: FavoriteSong[];
        startIndex: number;
        showNowPlayingView?: boolean;
      }
  );

export type ViewInstance = { id: ViewId };

export type ViewConfig = {
  title: string;
  /** Split views share the left menu panel with a preview on the right. */
  split: boolean;
  /** Games use the menu button themselves, so long-press must not reset. */
  disableLongPress?: boolean;
};
