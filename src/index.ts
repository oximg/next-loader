/**
 * A Next.js image loader that points `<Image>` at a self-hosted
 * [oximg](https://github.com/oximg/oximg) server instead of Next.js's
 * built-in, sharp-backed optimizer.
 *
 * Setting `images.loaderFile` makes Next.js call this function to build
 * the `src` for every image and every `srcset` entry. The `/_next/image`
 * route — and its in-process `sharp` transform — is never invoked. All
 * decoding, resizing, and re-encoding happens on the oximg server.
 *
 * This module is browser-safe: the loader runs in the client bundle to
 * build `srcset`, so it is pure string construction with no Node APIs
 * and no secrets. For signed URLs (which need a server-held key) see
 * the separate `@oximg/next-loader/sign` entry point.
 */

/** Output formats oximg accepts as an `@fmt` URL token. */
export type OximgFormat = "webp" | "avif" | "jpeg" | "png";

/** The argument Next.js passes to a custom image loader. */
export interface ImageLoaderProps {
  src: string;
  width: number;
  /**
   * Next.js always supplies this, but oximg's quality is configured
   * server-side (the `QUALITY` / `OXIMG_*_QUALITY` env vars), not
   * per-request. The loader accepts it for signature compatibility and
   * intentionally does not put it in the URL — doing so would only
   * fragment the cache with a parameter the server ignores.
   */
  quality?: number;
}

/** oximg's largest accepted dimension; also the default height bound. */
export const OXIMG_MAX_DIM = 8192;

export interface OximgLoaderOptions {
  /**
   * Base URL of the oximg server, e.g. `https://img.example.com`. A
   * single trailing slash is tolerated and stripped.
   */
  baseUrl: string;
  /**
   * oximg treats `(w, h)` as a bounding box: it scales to fit *inside*
   * the box, preserving aspect ratio and never enlarging. Next.js only
   * gives the loader a width, so a large height bound makes width the
   * sole constraint — matching Next.js's own width-only resize
   * (`withoutEnlargement`). Clamped to {@link OXIMG_MAX_DIM}.
   *
   * @default OXIMG_MAX_DIM
   */
  heightBound?: number;
  /**
   * Force an output format via oximg's `@fmt` token. Omit to let the
   * oximg server negotiate from the request's `Accept` header (which
   * needs `OXIMG_AUTO_FORMAT` set on the server) or fall back to the
   * source format.
   */
  format?: OximgFormat;
  /**
   * Translate the Next.js `src` into the single-segment filename oximg
   * serves. oximg's route is one path component — no slashes — so the
   * default strips a leading slash and rejects interior slashes. Supply
   * your own mapping if your `src` space is nested (e.g. flatten a key,
   * or map to an `OXIMG_SOURCE_BASE_URL` origin's flat namespace).
   *
   * @default strips a single leading slash
   */
  toFile?: (src: string) => string;
}

const KNOWN_FORMATS: readonly OximgFormat[] = ["webp", "avif", "jpeg", "png"];

function defaultToFile(src: string): string {
  return src.startsWith("/") ? src.slice(1) : src;
}

function clampDim(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`oximg loader: ${name} must be a finite number`);
  }
  const rounded = Math.round(value);
  if (rounded < 1) {
    throw new RangeError(`oximg loader: ${name} must be >= 1, got ${value}`);
  }
  return Math.min(rounded, OXIMG_MAX_DIM);
}

/**
 * Assemble the *decoded* oximg resize path (`/resize/{w}/{h}/{file}`,
 * including any `@fmt` token). This is the exact byte string the server
 * signs and verifies, so the signing helper reuses it. The filename is
 * left decoded here; {@link oximgUrl} percent-encodes it for transport.
 *
 * @internal
 */
export function buildResizePath(
  file: string,
  width: number,
  heightBound: number,
  format: OximgFormat | undefined,
): string {
  if (file === "") {
    throw new RangeError("oximg loader: filename resolved to an empty string");
  }
  if (/[/\\?#]|\.\./.test(file)) {
    throw new RangeError(
      `oximg loader: filename must be a single path segment (no / \\ ? # ..), got ${JSON.stringify(
        file,
      )}. Provide a toFile() that flattens your src.`,
    );
  }
  if (format !== undefined && !KNOWN_FORMATS.includes(format)) {
    throw new RangeError(`oximg loader: unknown format ${JSON.stringify(format)}`);
  }
  const w = clampDim(width, "width");
  const h = clampDim(heightBound, "heightBound");
  const suffix = format ? `@${format}` : "";
  return `/resize/${w}/${h}/${file}${suffix}`;
}

/**
 * Percent-encode the filename in a decoded resize path for use in a
 * URL, leaving the `/resize/{w}/{h}/` prefix and any `@fmt` token
 * intact. The server percent-decodes the segment back to the exact
 * string {@link buildResizePath} produced, so a signature over the
 * decoded path still verifies.
 *
 * @internal
 */
export function encodeResizePath(decodedPath: string): string {
  const prefix = decodedPath.slice(0, decodedPath.lastIndexOf("/") + 1);
  const rest = decodedPath.slice(prefix.length);
  const at = rest.lastIndexOf("@");
  // Only a trailing known-format token is a real suffix; anything else
  // (including a non-format `@` inside the name) is part of the filename
  // and must be percent-encoded.
  const token = at === -1 ? "" : rest.slice(at + 1);
  if (at !== -1 && (KNOWN_FORMATS as readonly string[]).includes(token)) {
    return `${prefix}${encodeURIComponent(rest.slice(0, at))}@${token}`;
  }
  return `${prefix}${encodeURIComponent(rest)}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new TypeError("oximg loader: baseUrl is required");
  }
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Build a single oximg resize URL. Useful outside `<Image>` (e.g. an
 * `<img>` `src`, Open Graph tags, or a `<link rel=preload>`).
 */
export function oximgUrl(options: OximgLoaderOptions, props: ImageLoaderProps): string {
  const base = normalizeBaseUrl(options.baseUrl);
  const toFile = options.toFile ?? defaultToFile;
  const heightBound = options.heightBound ?? OXIMG_MAX_DIM;
  const decodedPath = buildResizePath(toFile(props.src), props.width, heightBound, options.format);
  return `${base}${encodeResizePath(decodedPath)}`;
}

/**
 * Create the loader function for `images.loaderFile`.
 *
 * ```js
 * // image-loader.js
 * import { createOximgLoader } from "@oximg/next-loader";
 * export default createOximgLoader({ baseUrl: "https://img.example.com" });
 * ```
 *
 * ```js
 * // next.config.js
 * module.exports = {
 *   images: { loader: "custom", loaderFile: "./image-loader.js" },
 * };
 * ```
 */
export function createOximgLoader(
  options: OximgLoaderOptions,
): (props: ImageLoaderProps) => string {
  // Validate eagerly so a misconfigured baseUrl fails at startup, not on
  // the first rendered image.
  const base = normalizeBaseUrl(options.baseUrl);
  const resolved: OximgLoaderOptions = { ...options, baseUrl: base };
  return (props) => oximgUrl(resolved, props);
}
