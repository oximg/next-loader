# @oximg/next-loader

A Next.js image loader that serves `<Image>` from a self-hosted
[oximg](https://github.com/oximg/oximg) server instead of Next.js's
built-in, `sharp`-backed optimizer.

Point one config value at your oximg box and Next.js stops running image
optimization in-process. No `sharp`, no `/_next/image` compute on your
app server, no per-image Vercel Image Optimization charge — every
resize, re-encode, and format negotiation happens on oximg.

## How it replaces sharp

Next.js's default `<Image>` builds a `src` like
`/_next/image?url=…&w=640&q=75`. That URL hits a route handler
(`image-optimizer.ts`) that calls `sharp` **in your app's process** to
decode, resize, and re-encode the image.

Setting `images.loaderFile` swaps out the URL-building step. Next.js
calls *this* loader to produce the `src` for every image and every
`srcset` candidate — e.g.
`https://img.example.com/resize/640/8192/hero.jpg`. Those URLs go
straight to oximg, so the `/_next/image` route and its `sharp` call are
never reached. Optimization moves off your app server entirely.

The loader is pure string construction and runs in the browser bundle
too (Next.js rebuilds `srcset` client-side), so it holds no secrets and
imports no Node APIs.

## Install

```sh
npm install @oximg/next-loader
# and run an oximg server: https://github.com/oximg/oximg
```

## Usage

```js
// image-loader.js
import { createOximgLoader } from "@oximg/next-loader";

export default createOximgLoader({
  baseUrl: "https://img.example.com", // your oximg server
});
```

```js
// next.config.js
module.exports = {
  images: {
    loader: "custom",
    loaderFile: "./image-loader.js",
  },
};
```

That's it. `<Image src="/hero.jpg" width={1200} height={630} />` now
resolves each `srcset` entry to
`https://img.example.com/resize/<w>/8192/hero.jpg`.

## How Next.js maps onto oximg's URL

| Next.js loader input | oximg URL | Notes |
| --- | --- | --- |
| `width` | first path dim `w` | The rendered/`srcset` width. |
| (no height) | second dim `h` = `heightBound` (default `8192`) | oximg fits *inside* `w×h`, aspect-preserving, never enlarging — matching Next.js's own width-only `withoutEnlargement` resize. A large bound makes width the sole constraint. |
| `src` | last path segment (the filename) | See **Source paths** below. |
| `quality` | — | oximg sets quality server-side (`QUALITY`, `OXIMG_WEBP_QUALITY`, …), not per-request. The loader ignores it rather than fragment the cache with a param the server drops. |

### Output format

By default the loader emits no format token, so oximg either negotiates
from the request's `Accept` header (when the server has
`OXIMG_AUTO_FORMAT` set) or returns the source format. To force one:

```js
createOximgLoader({ baseUrl: "https://img.example.com", format: "avif" });
// → …/resize/640/8192/hero.jpg@avif
```

Supported: `"webp" | "avif" | "jpeg" | "png"`.

### Source paths

oximg's route is a **single path segment** — filenames may not contain
`/`, `\`, `?`, `#`, or `..`. By default the loader strips a leading
slash and otherwise passes `src` through, so a flat namespace
(`/hero.jpg` → `hero.jpg`, served from the server's `IMAGES_DIR` or
`OXIMG_SOURCE_BASE_URL`) works out of the box. Interior slashes throw a
clear error. For nested sources, supply a `toFile` mapping:

```js
createOximgLoader({
  baseUrl: "https://img.example.com",
  toFile: (src) => src.replace(/^\/+/, "").replaceAll("/", "__"),
});
```

## Signed URLs (server-side)

oximg supports imgproxy-style URL signing (`OXIMG_KEY` / `OXIMG_SALT`).
Signing needs the secret key, which must never reach the browser — so it
lives in a **separate, Node-only entry point** and cannot be used as
`loaderFile`. Generate signed URLs where a secret is safe: a Server
Component, a Route Handler, or `generateMetadata`.

```js
import { signedOximgUrl } from "@oximg/next-loader/sign";

const url = signedOximgUrl(
  { baseUrl: "https://img.example.com", format: "avif" },
  { key: process.env.OXIMG_KEY, salt: process.env.OXIMG_SALT }, // hex
  { src: "/hero.jpg", width: 1200 },
);
// → https://img.example.com/<sig>/resize/1200/8192/hero.jpg@avif
```

The signature is `base64url(HMAC-SHA256(key, salt || path))` over the
decoded path — byte-for-byte what the oximg server verifies. Also
exported: `signResizePath`, `verifyResizePath`,
`createSignedOximgUrlBuilder`.

## API

Main entry (`@oximg/next-loader`, browser-safe):

- `createOximgLoader(options)` → `(props) => string` — the `loaderFile` default export.
- `oximgUrl(options, props)` — build one URL outside `<Image>` (OG tags, preloads).
- `OXIMG_MAX_DIM` — `8192`, oximg's dimension ceiling.

Sign entry (`@oximg/next-loader/sign`, Node-only):

- `signedOximgUrl(options, signingKey, props)` — full signed URL.
- `createSignedOximgUrlBuilder(options, signingKey)` — curried `(props) => url`.
- `signResizePath(path, signingKey)` / `verifyResizePath(sig, path, signingKey)`.

`options`: `{ baseUrl, heightBound?, format?, toFile? }`.
`signingKey`: `{ key, salt }` (both hex).

## License

Apache-2.0
