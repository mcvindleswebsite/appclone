export type DeviceThemeName = "silver" | "black";

export type DeviceTheme = {
  body: string;
  clickwheel: {
    background: string;
    button: string;
    centerBackground: string;
    centerShadow: string;
    outline: string;
  };
};

export const DEVICE_THEMES: Record<DeviceThemeName, DeviceTheme> = {
  silver: {
    body: "linear-gradient(180deg, #e3e3e3 0%, #d6d6d6 100%)",
    clickwheel: {
      background: "#FFFFFF",
      button: "#AFAFAF",
      centerBackground: "#ffffff",
      centerShadow: "rgb(191, 191, 191)",
      outline: "#b9b9b9",
    },
  },
  black: {
    body: "linear-gradient(180deg, #7d7c7d 0%, #1e1e1e 100%)",
    clickwheel: {
      background: "#2a2a2a",
      button: "#FFFFFF",
      centerBackground: "#7d7c7d",
      centerShadow: "rgb(50, 50, 50)",
      outline: "#1a1a1a",
    },
  },
};

/** The shell follows the OS: Black in dark mode, Silver in light mode. */
export const getSystemDeviceTheme = (prefersDark: boolean): DeviceThemeName =>
  prefersDark ? "black" : "silver";
