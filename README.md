# The Dutchy Finch

A bespoke, responsive website for The Dutchy Finch at Dirty Janes Canberra. The supplied finch animation introduces a vintage monochrome page, then brings the website into colour as the bird lands.

## Run and build

Requires Node.js 20 or newer. There are no runtime or build dependencies to install.

```sh
npm run check
npm run build
```

The build writes the deployable website to `dist/`. For local development, serve the `public/` directory with a static HTTP server. To review the complete deployment headers and social metadata, serve `dist/` after building.

## Deployment

The repository includes `netlify.toml`. Connect this repository to Netlify with these settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Node version | `22` |

Netlify's `URL` environment variable sets the canonical and social preview URLs at build time. Other hosts can set `SITE_URL` to the final HTTPS origin. Without either variable, the build uses the private review site's origin.

The tracked `.openai/hosting.json` identifies the corresponding review site and its static output directory. It contains no credentials.

## Editing the site

- `public/index.html`: business copy, service descriptions, social links, location and structured data.
- `public/styles.css`: typography, colours and responsive layout.
- `public/main.js`: optional introduction, mobile navigation, map loading and address copying.
- `public/gallery.js` and `public/gallery.css`: photograph grid, expand/collapse controls and the accessible full-photo viewer.
- `public/privacy/index.html`: privacy note reflecting this implementation.
- `public/assets/`: compressed media, fonts and brand artwork.
- `scripts/build.mjs`: static build, canonical URLs and Content Security Policy script hashes.
- `scripts/check.mjs`: structural, local-link, asset, JavaScript syntax and video-size checks.
- `scripts/test-intro.mjs`: animation startup, loading fallback, controls and visibility regression checks, included in `npm run check`.
- `docs/gallery-assets.json`: supplied photo provenance, descriptions, dimensions and compression measurements.

The site uses the supplied email address (hello@thedutchyfinch.com.au), Instagram and Facebook profiles for enquiries. There is no shop checkout, enquiry form, inventory feed or invented business contact information.

## The finch animation

The original supplied video is 9,614,135 bytes, 1920 × 1080 and approximately eight seconds long. The web versions use H.264, a broadly supported pixel format and a fast-start MP4 layout. There is no audio track.

| Asset | Dimensions | Bytes | Reduction from original |
| --- | --- | ---: | ---: |
| Desktop MP4 | 1280 × 720 | 779,637 | 91.9% |
| Mobile MP4 | 960 × 540 | 445,457 | 95.4% |
| Mobile animated WebP / desktop fallback | 800 × 450 | 747,908 | 92.2% |

Each opening starts automatically in monochrome. Both the initial HTML artwork and the page colours use the actual black-and-white opening frame, so startup does not rely on JavaScript replacing a colour still. Colour begins returning at 3.4 seconds, matching the bird's landing. The full artwork remains visible at its original 16:9 aspect ratio.

Phones and touch devices use the animated WebP immediately, without requesting or waiting for video playback. Selection includes narrow screens and coarse pointers, covering phones in landscape. The 8,083 ms clip plays once; its 88 encoded frames preserve the original flight and colour reveal. It is cached in memory and assigned a fresh object URL for each playback so every arrival starts at frame one. While it downloads, the opening remains monochrome with Skip available. A slow download never advances to colour on a timer before the animation has played.

Desktop video uses native autoplay, muted inline playback and a visible monochrome poster. Only one video source is selected, based on the initial screen width. If the browser refuses or interrupts playback, or no first frame arrives within four seconds, the same clip plays through the image renderer. After playback begins, a stalled video has a twelve-second deadline before switching to the image. Both renderers offer Skip while the introduction is active. There is no Play or Replay button; refreshing the page starts the introduction again. The control disappears after completion. Timers and image URLs are cleared on Skip, failure and departure. If the image cannot load or decode, the full-colour still remains usable.

The requested every-arrival behaviour applies regardless of stored visit flags, reduced-motion or data-saving signals; those signals no longer silently replace the introduction with the final colour still. Skip remains available, and the stylesheet still reduces its other transitions and effects for reduced-motion preferences. Pages opened in the background wait until visible to begin. Native video resumes at its previous position after backgrounding. The one-shot image restarts from the beginning when returning to the page; a completed introduction also restarts on return. Departure prepares a monochrome snapshot before a back/forward-cache restoration. With JavaScript disabled, the monochrome page and navigation remain available.

Production builds give the main script a content-based filename, so a returning browser requests the new introduction code after an update.

The original large video and GIF are intentionally excluded from this repository. The brand artwork and animation were supplied by the site requester for this project.

## Photograph gallery

All 13 supplied photographs are included: one shop photograph in the story section and 12 in the gallery. The gallery starts with six photographs and offers a “See all 12 photos” control. Without JavaScript all photographs remain visible and link directly to the larger images.

The native dialog viewer supports next/previous buttons, arrow keys, swipe gestures, Escape to close and focus return. It displays each entire photograph without cropping. Larger gallery images are requested only when selected; the story image uses responsive sizes.

| Photo asset set | Total bytes |
| --- | ---: |
| Original PNG uploads | 43,279,719 |
| All 13 thumbnails | 518,604 |
| All 13 larger photographs | 2,052,944 |
| Combined web assets | 2,571,548 |

The complete set is 94.1% smaller than the originals. Thumbnails have a maximum edge of 600 px; larger views have a maximum edge of 1400 px. The first six gallery thumbnails total 218,674 bytes. WebP encoding preserves the complete composition and aspect ratio, with no enlargement or generative editing. Original uploads are not included in this repository.

Gallery copy presents past and present finds and directs availability enquiries to the supplied social profile.

## Content sources

- Brand positioning, specialities and social profiles: supplied by the requester.
- Venue address, arrival directions and normal opening hours: [Dirty Janes Canberra](https://dirtyjanes.com/dirty-janes-canberra/).
- Public holiday information: [Dirty Janes opening hours](https://dirtyjanes.com/opening-hours/).

Opening hours are explicitly labelled as Dirty Janes' hours. Check the linked venue information when updating the site.

## Fonts and privacy

Cormorant Garamond and DM Sans are self-hosted. Their SIL Open Font License notices are included in `public/assets/licenses/`.

There are no analytics scripts, advertising pixels or externally loaded font services. The Google map loads only when requested by the visitor. The introduction does not store a playback preference; it starts afresh on each opening.
