"use client";

import { profile } from "@/data/profile";

import { AudioProvider } from "./audio-context";
import { ClickWheel } from "./ClickWheel";
import { IpodProvider, useSettings } from "./ipod-context";
import { ShowcaseDevice, useShowcase } from "./showcase";
import { DEVICE_THEMES, getSystemDeviceTheme } from "./themes";
import { useSystemDarkMode } from "./use-system-dark-mode";
import { ViewManager } from "./ViewManager";
import styles from "./ipod.module.css";

const Shell = () => {
  const { deviceTheme } = useSettings();

  return (
    <div className={styles.shell} style={{ background: DEVICE_THEMES[deviceTheme].body }}>
      <div className={styles.screen}>
        <ViewManager />
      </div>
      <div className={styles.wheelContainer} data-showcase-ignore>
        <ClickWheel />
      </div>
    </div>
  );
};

/**
 * The device mounts client-side once the OS color scheme is known, so the
 * shell never flashes the wrong theme and server/client markup match.
 */
export const Ipod = () => {
  const prefersDark = useSystemDarkMode();
  const showcase = useShowcase();

  return (
    <main
      className={styles.page}
      // Same value the shell renders with, so page and device always match.
      data-device-theme={prefersDark === null ? undefined : getSystemDeviceTheme(prefersDark)}
      data-showcase={showcase.isBackdropDark}
    >
      <h1 className={styles.srOnly}>
        {profile.name} (@{profile.handle})
      </h1>
      <nav className={styles.srOnly} aria-label="Social links">
        <ul>
          {profile.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label} {link.sublabel}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {prefersDark !== null && (
        <IpodProvider prefersDark={prefersDark}>
          <AudioProvider>
            <ShowcaseDevice isSpinning={showcase.isSpinning} onShowcase={showcase.start}>
              <Shell />
            </ShowcaseDevice>
          </AudioProvider>
        </IpodProvider>
      )}
    </main>
  );
};
