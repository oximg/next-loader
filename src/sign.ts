/**
 * Server-only helper for oximg's imgproxy-style signed URLs.
 *
 * The signing key must never reach the browser, so this is a **separate
 * entry point** (`@oximg/next-loader/sign`) that imports `node:crypto`.
 * Use it where a secret is safe — a Server Component, a Route Handler,
 * `generateMetadata`, or a build step — to mint full `<img>`/OG URLs.
 * It cannot be used as `images.loaderFile`, which runs in the client
 * bundle.
 *
 * oximg verifies `base64url(HMAC-SHA256(key, salt || path))`, with `key`
 * and `salt` hex-encoded and the signature base64url without padding,
 * over the decoded path `/resize/{w}/{h}/{file}` (the `@fmt` token, if
 * any, is part of the signed material).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  buildResizePath,
  encodeResizePath,
  type ImageLoaderProps,
  type OximgLoaderOptions,
} from "./index.js";

export interface OximgSigningKey {
  /** Hex-encoded HMAC key — the server's `OXIMG_KEY`. */
  key: string;
  /** Hex-encoded salt prefix — the server's `OXIMG_SALT`. */
  salt: string;
}

function hexToBytes(hex: string, name: string): Buffer {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new TypeError(`oximg sign: ${name} must be a non-empty hex string`);
  }
  return Buffer.from(hex, "hex");
}

/**
 * Sign a decoded oximg resize path exactly as the server verifies it.
 * `path` starts at `/resize/…` and includes any `@fmt` token. Returns
 * the base64url signature (no padding) that goes in the URL's first
 * segment.
 */
export function signResizePath(path: string, signing: OximgSigningKey): string {
  const key = hexToBytes(signing.key, "key");
  const salt = hexToBytes(signing.salt, "salt");
  const mac = createHmac("sha256", key);
  mac.update(salt);
  mac.update(path, "utf8");
  return mac.digest("base64url");
}

/**
 * Verify a base64url signature against a decoded resize path. Mirrors
 * the server so tests and middleware can check links locally. Constant
 * time in the signature comparison.
 */
export function verifyResizePath(
  signature: string,
  path: string,
  signing: OximgSigningKey,
): boolean {
  const expected = Buffer.from(signResizePath(path, signing), "utf8");
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/**
 * Build a full, signed oximg URL:
 * `{baseUrl}/{sig}/resize/{w}/{h}/{file}[@fmt]`.
 */
export function signedOximgUrl(
  options: OximgLoaderOptions,
  signing: OximgSigningKey,
  props: ImageLoaderProps,
): string {
  const base = options.baseUrl.replace(/\/+$/, "");
  const toFile = options.toFile ?? ((src: string) => (src.startsWith("/") ? src.slice(1) : src));
  const heightBound = options.heightBound ?? 8192;
  const decodedPath = buildResizePath(toFile(props.src), props.width, heightBound, options.format);
  const sig = signResizePath(decodedPath, signing);
  return `${base}/${sig}${encodeResizePath(decodedPath)}`;
}

/**
 * A curried signer for building many URLs with one key. The returned
 * function has the `(props) => url` shape of a loader, but must run
 * server-side — do not pass it to `images.loaderFile`.
 */
export function createSignedOximgUrlBuilder(
  options: OximgLoaderOptions,
  signing: OximgSigningKey,
): (props: ImageLoaderProps) => string {
  return (props) => signedOximgUrl(options, signing, props);
}
