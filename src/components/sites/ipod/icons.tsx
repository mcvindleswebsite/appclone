/* Click-wheel glyphs extracted from iPod.js (MIT, Tanner Villarete). */

type IconProps = { color: string };

export const MenuIcon = ({ color }: IconProps) => (
  <svg width="45" height="17" viewBox="0 0 61 17" fill="none" aria-hidden="true">
    <path
      d="M10.6177 0.885742H15.1602V16H12.2173V5.77686C12.2173 5.48291 12.2207 5.07275 12.2275 4.54639C12.2344 4.01318 12.2378 3.60303 12.2378 3.31592L9.37695 16H6.31104L3.4707 3.31592C3.4707 3.60303 3.47412 4.01318 3.48096 4.54639C3.48779 5.07275 3.49121 5.48291 3.49121 5.77686V16H0.54834V0.885742H5.14209L7.89014 12.77L10.6177 0.885742ZM29.6895 3.56201H21.6915V6.77148H29.0333V9.39648H21.6915V13.2827H30.0587V16H18.6051V0.885742H29.6895V3.56201ZM32.8883 0.885742H36.2004L42.2194 11.437V0.885742H45.1623V16H42.0041L35.8312 5.26416V16H32.8883V0.885742ZM48.5354 0.885742H51.7449V10.1758C51.7449 11.2148 51.8679 11.9736 52.114 12.4521C52.4968 13.2998 53.3308 13.7236 54.616 13.7236C55.8943 13.7236 56.7248 13.2998 57.1077 12.4521C57.3537 11.9736 57.4768 11.2148 57.4768 10.1758V0.885742H60.6863V10.1758C60.6863 11.7822 60.4368 13.0332 59.9377 13.9287C59.008 15.5693 57.2341 16.3896 54.616 16.3896C51.9978 16.3896 50.2204 15.5693 49.2839 13.9287C48.7849 13.0332 48.5354 11.7822 48.5354 10.1758V0.885742Z"
      fill={color}
    />
  </svg>
);

export const RewindIcon = ({ color }: IconProps) => (
  <svg width="25" height="16" viewBox="0 0 33 16" fill="none" aria-hidden="true">
    <path d="M17 8L29 1.0718V14.9282L17 8Z" fill={color} />
    <path d="M4 8L16 1.0718V14.9282L4 8Z" fill={color} />
    <rect x="4" y="16" width="4" height="15" transform="rotate(-180 4 16)" fill={color} />
  </svg>
);

export const FastForwardIcon = ({ color }: IconProps) => (
  <svg width="25" height="16" viewBox="0 0 33 16" fill="none" aria-hidden="true">
    <path d="M16 8L4 14.9282L4 1.0718L16 8Z" fill={color} />
    <path d="M29 8L17 14.9282V1.0718L29 8Z" fill={color} />
    <rect x="29" width="4" height="15" fill={color} />
  </svg>
);

export const PlayPauseIcon = ({ color }: IconProps) => (
  <svg width="27" height="15" viewBox="0 0 39 18" fill="none" aria-hidden="true">
    <path d="M18 9L4.5 16.7942L4.5 1.20577L18 9Z" fill={color} />
    <rect x="26" y="1" width="4" height="16" fill={color} />
    <rect x="35" y="1" width="4" height="16" fill={color} />
  </svg>
);
