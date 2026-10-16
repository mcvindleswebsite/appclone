export type ProfileLink = {
  label: string;
  sublabel: string;
  url: string;
};

export const profile = {
  name: "Vincent Velasco",
  handle: "mcvindle",
  links: [
    {
      label: "Instagram",
      sublabel: "@mcvindle",
      url: "https://ig.mcvindle.com",
    },
    {
      label: "TikTok",
      sublabel: "@mcvindle",
      url: "https://tt.mcvindle.com",
    },
    {
      label: "Twitch",
      sublabel: "@mcvindle",
      url: "https://twitch.mcvindle.com",
    },
  ] satisfies ProfileLink[],
};
