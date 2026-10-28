/** The slice of Apple's MusicKit JS v3 (js-cdn.music.apple.com/musickit/v3/musickit.js) the /lyrics player uses. */
export interface MusicKitInstance {
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  readonly isAuthorized: boolean;
  readonly isPlaying: boolean;
  readonly currentPlaybackTime: number;
  readonly currentPlaybackDuration: number;
  volume: number;
  setQueue(options: { song?: string; startPlaying?: boolean }): Promise<unknown>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seekToTime(seconds: number): Promise<void>;
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
}

export interface MusicKitStatic {
  configure(options: { developerToken: string; app: { name: string; build: string } }): Promise<MusicKitInstance>;
  getInstance(): MusicKitInstance;
}

declare global {
  interface Window {
    MusicKit?: MusicKitStatic;
  }
}
