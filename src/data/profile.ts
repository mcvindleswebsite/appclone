export type ProfileLink = {
  label: string;
  sublabel: string;
  url: string;
  /**
   * Live avatar via the unavatar.io proxy. `fallback=false` makes a failed
   * lookup return an error (instead of unavatar's generic placeholder), so
   * the UI shows the "VV" initials instead.
   */
  avatarUrl: string;
};

export const profile = {
  name: "Vincent Velasco",
  handle: "mcvindle",
  links: [
    {
      label: "Instagram",
      sublabel: "@mcvindle",
      url: "https://ig.mcvindle.com",
      // Note: unavatar's Instagram provider needs a paid plan; on the free
      // tier this returns 403 and the initials fallback is shown.
      avatarUrl: "https://unavatar.io/instagram/mcvindle?fallback=false",
    },
    {
      label: "TikTok",
      sublabel: "@mcvindle",
      url: "https://tt.mcvindle.com",
      // The "@mcvindle" form is rejected on the free tier; the bare handle works.
      avatarUrl: "https://unavatar.io/tiktok/mcvindle?fallback=false",
    },
    {
      label: "Twitch",
      sublabel: "@mcvindle",
      url: "https://twitch.mcvindle.com",
      avatarUrl: "https://unavatar.io/twitch/mcvindle?fallback=false",
    },
  ] satisfies ProfileLink[],
};

export const profileInitials = profile.name
  .split(" ")
  .map((part) => part[0])
  .join("");
