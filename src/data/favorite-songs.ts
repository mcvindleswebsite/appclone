/**
 * Vincent's favorite tracks, played locally by the iPod's Music list.
 *
 * No streaming account or sign-in is involved: each entry points at a cover
 * image and a short audio preview. To customize, edit this list.
 *
 * - `coverArt` and `previewUrl` accept absolute URLs or paths under `public/`
 *   (e.g. drop files in `public/sites/ipod/music/` and use
 *   "/sites/ipod/music/my-song.m4a").
 * - Remote audio must be served with CORS (Access-Control-Allow-Origin), since
 *   playback runs through Web Audio for volume control. Apple's preview CDN
 *   does; files in `public/` always work.
 * - These entries use Apple's public 30-second iTunes previews and 600×600
 *   artwork (looked up via the iTunes Search API).
 */
export type FavoriteSong = {
  /** Stable, unique identifier. */
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** Square cover image (600×600 recommended). */
  coverArt: string;
  /** Playable audio clip (m4a/mp3/ogg). */
  previewUrl: string;
};

export const favoriteSongs: FavoriteSong[] = [
  {
    id: "slow-dancing-in-a-burning-room",
    title: "Slow Dancing in a Burning Room",
    artist: "John Mayer",
    album: "Continuum",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/7a/a0/f4/7aa0f487-f983-390e-73ef-005115eea1e0/dj.oqpplyfm.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/2a/ab/53/2aab53e6-ed87-1ce8-3b12-01c5a847aa42/mzaf_15151430342496758350.plus.aac.p.m4a",
  },
  {
    id: "shes-always-a-woman",
    title: "She's Always a Woman",
    artist: "Billy Joel",
    album: "The Stranger",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/83/de/8e/83de8ea5-1022-38cc-2f0f-6c5ec45c08bd/886444123815.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/4c/0b/cc/4c0bccdb-4238-60d6-f957-a29183c4ca54/mzaf_13133189800023244548.plus.aac.p.m4a",
  },
  {
    id: "better-late-than-never",
    title: "Better Late Than Never",
    artist: "Romeo Santos & Prince Royce",
    album: "Better Late Than Never",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/60/66/a9/6066a9a2-b1e8-d171-d8b3-7d044c040b94/196873751887.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/f6/61/9a/f6619aa8-bfe3-5a4b-764c-05e3269e5c04/mzaf_17428150810413708931.plus.aac.p.m4a",
  },
  {
    id: "maroon",
    title: "Maroon",
    artist: "Kevin Abstract & Dominic Fike",
    album: "Blush",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a4/d9/2f/a4d92f61-543b-70c1-0b8c-7a16d9345eaf/198704617607_Cover.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/e8/20/ac/e820acec-e22f-7378-2e13-bbd2e651efd8/mzaf_8654939163166615443.plus.aac.p.m4a",
  },
  {
    id: "mitsubishi",
    title: "mitsubishi",
    artist: "earfzilla",
    album: "mitsubishi - Single",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/50/a7/34/50a7342d-83d6-401a-6b18-b8556669e129/199316679069_cover.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/11/e9/29/11e92909-5d0e-3315-c34f-56eca047698f/mzaf_3560373124792734804.plus.aac.p.m4a",
  },
  {
    id: "blame-it-on-the-sun",
    title: "Blame It on the Sun",
    artist: "Stevie Wonder",
    album: "Talking Book",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/62/61/61/626161c0-f4d7-e6ff-8586-768340ef278f/00602537002382.rgb.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/99/df/27/99df2788-bd41-eac4-e9e3-03aa43ea9cf4/mzaf_15041049974211889637.plus.aac.p.m4a",
  },
  {
    id: "one-of-those-crazy-girls",
    title: "(One of Those) Crazy Girls",
    artist: "Paramore",
    album: "Paramore",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/32/cb/9d/32cb9d04-ef0f-93bb-fd2f-19b395785025/075679956187.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/62/61/63/62616316-3fa4-c9fa-7f90-13d7eee44c38/mzaf_6443458356365829223.plus.aac.p.m4a",
  },
  {
    id: "wayback-machine",
    title: "Wayback Machine",
    artist: "Mitch Marsico",
    album: "Wayback Machine - Single",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/3c/04/4a/3c044a54-f393-12ca-5633-b9026e8ecf4a/artwork.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/de/c7/73/dec77338-a3a6-c636-1fde-23b3a9333df6/mzaf_6991733807105899076.plus.aac.p.m4a",
  },
  {
    id: "wake-up-call",
    title: "Wake Up Call",
    artist: "Maroon 5",
    album: "It Won't Be Soon Before Long",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/d1/f6/02/d1f602c4-e185-4ce5-c361-23af7c857628/07UMGIM06094.rgb.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/40/a8/06/40a8061c-78fc-8835-fbd4-56a9b255f0be/mzaf_1916507818919347095.plus.aac.p.m4a",
  },
  {
    id: "indecision",
    title: "Indecision",
    artist: "Rex Orange County & Daniel Caesar",
    album: "Dream Fatigue",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c0/80/be/c080be0b-c579-4dba-27a1-8ac82768e1f2/885288429602.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/a8/d5/a8/a8d5a89c-58da-b3c5-1c46-ac90d59efad7/mzaf_11970592240236397535.plus.aac.p.m4a",
  },
];
