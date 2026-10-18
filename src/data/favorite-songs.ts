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
    id: "stop-this-train",
    title: "Stop This Train",
    artist: "John Mayer",
    album: "Continuum",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/7a/a0/f4/7aa0f487-f983-390e-73ef-005115eea1e0/dj.oqpplyfm.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/58/a9/10/58a9104b-1e60-9b1f-888f-e2bb336e5a8f/mzaf_12466028291604393207.plus.aac.p.m4a",
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
    id: "dardos",
    title: "Dardos",
    artist: "Romeo Santos & Prince Royce",
    album: "Better Late Than Never",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/60/66/a9/6066a9a2-b1e8-d171-d8b3-7d044c040b94/196873751887.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/dd/72/96/dd72963a-c515-a551-b47e-583c99c6bfd0/mzaf_10273637570356807203.plus.aac.p.m4a",
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
    id: "vintage-vuitton",
    title: "vintage vuitton",
    artist: "earfzilla",
    album: "vintage vuitton - Single",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/65/08/01/650801d9-4015-199b-9bff-b22c41758801/199316780888_cover.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/93/1f/4d/931f4ddc-ea39-f2ef-9b65-0f04af2ac8d1/mzaf_17344213775783142212.plus.aac.p.m4a",
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
    id: "4-seasons",
    title: "4 Seasons",
    artist: "Rex Orange County",
    album: "Apricot Princess",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/2d/1e/73/2d1e7358-0dde-30fc-b5fe-d6ca7d975954/5060450063043_1.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/9c/d3/06/9cd306ef-34c4-696b-8372-2bba5c513b59/mzaf_1070739444292157394.plus.aac.p.m4a",
  },
  {
    id: "sunday-morning",
    title: "Sunday Morning",
    artist: "No Doubt",
    album: "Tragic Kingdom",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/fe/0a/68/fe0a687a-537e-e902-0778-90465c118f77/00602547870575.rgb.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/90/aa/de/90aade2c-282f-f719-09b3-eef97cceacfe/mzaf_7055869600242462279.plus.aac.p.m4a",
  },
  {
    id: "down-under",
    title: "Down Under",
    artist: "Men At Work",
    album: "Business As Usual",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Features115/v4/80/07/23/80072391-3543-cdb9-e298-08d5f0595f41/dj.uyepaoyc.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/76/1c/6e/761c6e1d-1b95-e87f-bcec-41afc0836a9a/mzaf_11800999298773408397.plus.aac.p.m4a",
  },
  {
    id: "come-back-to-earth",
    title: "Come Back to Earth",
    artist: "Mac Miller",
    album: "Swimming",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e3/38/b5/e338b529-da3f-b4b9-b8f9-1fae428e7a23/093624905899.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/04/bf/10/04bf10ed-0dae-fe63-94bc-eba16a7b8faa/mzaf_4512545557535985538.plus.aac.p.m4a",
  },
  {
    id: "cant-smile-without-you",
    title: "Can't Smile Without You",
    artist: "Barry Manilow",
    album: "Ultimate Manilow",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/4f/1e/49/4f1e498c-bfd1-9a74-bfb9-e4945e3ce851/mzi.nbijprbi.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/3b/9d/42/3b9d4296-9899-b8df-72aa-2b6be999ccfe/mzaf_17443934839668555103.plus.aac.p.m4a",
  },
  {
    id: "a-dios-le-pido",
    title: "A Dios Le Pido",
    artist: "Juanes",
    album: "Un Día Normal",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/74/77/93/7477934f-be02-1ac6-a909-8b67a9cd067b/22UMGIM50939.rgb.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/67/77/7c/67777c42-d99d-7700-022f-3809fde999bb/mzaf_1005235569969926363.plus.aac.p.m4a",
  },
  {
    id: "bitch",
    title: "Bitch",
    artist: "Road to Bremen",
    album: "Foreword - EP",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/fe/05/ef/fe05ef13-3982-b5a7-14bb-97b03c4f0df1/artwork.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/f6/0c/36/f60c3678-5c54-64dd-e9e3-fde65900e322/mzaf_11315200017619150810.plus.aac.p.m4a",
  },
  {
    id: "last-night-on-earth",
    title: "Last Night on Earth",
    artist: "Green Day",
    album: "21st Century Breakdown",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music/eb/d6/fc/mzi.ppkbuzdu.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/dd/7b/59/dd7b59e0-729a-3e3d-0a2e-ea169d19326d/mzaf_16747645017638451316.plus.aac.p.m4a",
  },
  {
    id: "hey-there-delilah",
    title: "Hey There Delilah",
    artist: "Plain White T's",
    album: "Every Second Counts",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/a8/a4/23/a8a423e8-643b-79d0-81e4-00b3ca683b8c/00050087104436.rgb.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/f6/82/42/f6824288-2d1e-7a1f-ed84-6b435cbfea74/mzaf_3615908399069987941.plus.aac.p.m4a",
  },
  {
    id: "rest-up",
    title: "Rest Up",
    artist: "boy pablo",
    album: "Rest Up - Single",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/a6/cc/21/a6cc2148-840d-b6eb-79ae-9776f26c4c76/192641534249_Cover.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/fc/5c/4c/fc5c4c00-3050-eefd-57a1-3339c4e910b1/mzaf_14378785864077706484.plus.aac.p.m4a",
  },
  {
    id: "who-knows",
    title: "Who Knows",
    artist: "Daniel Caesar",
    album: "Son Of Spergy",
    coverArt:
      "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/3b/c0/c5/3bc0c51d-33f2-ee19-e148-6d8f2c50df24/25UMGIM90843.rgb.jpg/600x600bb.jpg",
    previewUrl:
      "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/f2/af/b0/f2afb01b-42c5-7803-be2f-b7365c9a928a/mzaf_17144887126595930673.plus.aac.p.m4a",
  },
];
