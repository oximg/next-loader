import { describe, expect, it } from "vitest";

import {
  createSignedOximgUrlBuilder,
  signResizePath,
  signedOximgUrl,
  verifyResizePath,
  type OximgSigningKey,
} from "../src/sign.js";

const SIGNING: OximgSigningKey = { key: "0011", salt: "2233" };
const BASE = "https://img.example.com";

describe("signResizePath", () => {
  it("matches the oximg algorithm: base64url(HMAC-SHA256(key, salt || path))", () => {
    // Vector for key=0011 salt=2233 path=/resize/640/8192/cat.jpg,
    // base64url without padding — the exact form the Rust server's
    // base64url_decode + hmac.verify_slice accepts.
    expect(signResizePath("/resize/640/8192/cat.jpg", SIGNING)).toBe(
      "xT5I-pEUk6eJVevom0LuHaXLx7uDI0u43qU5C7MFPsA",
    );
  });

  it("includes the @fmt token in the signed material", () => {
    const withFmt = signResizePath("/resize/640/8192/cat.jpg@avif", SIGNING);
    const without = signResizePath("/resize/640/8192/cat.jpg", SIGNING);
    expect(withFmt).not.toBe(without);
  });

  it("produces an unpadded base64url signature (chars only in -_A-Za-z0-9)", () => {
    const sig = signResizePath("/resize/1/1/a.jpg", SIGNING);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sig).not.toContain("=");
  });

  it("rejects a non-hex key", () => {
    expect(() => signResizePath("/resize/1/1/a.jpg", { key: "zz", salt: "2233" })).toThrow(
      /key must be a non-empty hex string/,
    );
  });

  it("rejects an odd-length hex key", () => {
    expect(() => signResizePath("/resize/1/1/a.jpg", { key: "001", salt: "2233" })).toThrow(
      /key must be a non-empty hex string/,
    );
  });

  it("rejects an empty key", () => {
    expect(() => signResizePath("/resize/1/1/a.jpg", { key: "", salt: "2233" })).toThrow(
      /key must be a non-empty hex string/,
    );
  });

  it("rejects a non-hex salt", () => {
    expect(() => signResizePath("/resize/1/1/a.jpg", { key: "0011", salt: "xy" })).toThrow(
      /salt must be a non-empty hex string/,
    );
  });
});

describe("verifyResizePath", () => {
  const path = "/resize/640/8192/cat.jpg";

  it("accepts a signature it just produced", () => {
    const sig = signResizePath(path, SIGNING);
    expect(verifyResizePath(sig, path, SIGNING)).toBe(true);
  });

  it("rejects a tampered path", () => {
    const sig = signResizePath(path, SIGNING);
    expect(verifyResizePath(sig, "/resize/641/8192/cat.jpg", SIGNING)).toBe(false);
  });

  it("rejects a signature of the wrong length", () => {
    expect(verifyResizePath("short", path, SIGNING)).toBe(false);
  });

  it("rejects a same-length but wrong signature", () => {
    const sig = signResizePath(path, SIGNING);
    const flipped = `${sig.slice(0, -1)}${sig.at(-1) === "A" ? "B" : "A"}`;
    expect(verifyResizePath(flipped, path, SIGNING)).toBe(false);
  });
});

describe("signedOximgUrl", () => {
  it("assembles {base}/{sig}/resize/{w}/{h}/{file}", () => {
    const url = signedOximgUrl({ baseUrl: BASE }, SIGNING, {
      src: "/cat.jpg",
      width: 640,
    });
    const sig = signResizePath("/resize/640/8192/cat.jpg", SIGNING);
    expect(url).toBe(`${BASE}/${sig}/resize/640/8192/cat.jpg`);
  });

  it("signs the decoded path but percent-encodes the URL filename", () => {
    const url = signedOximgUrl({ baseUrl: BASE }, SIGNING, {
      src: "/my pic.jpg",
      width: 300,
    });
    // Signature is over the DECODED path (spaces intact), matching what
    // the server reconstructs after percent-decoding the segment.
    const sig = signResizePath("/resize/300/8192/my pic.jpg", SIGNING);
    expect(url).toBe(`${BASE}/${sig}/resize/300/8192/my%20pic.jpg`);
  });

  it("carries a forced format into both the signature and the URL", () => {
    const url = signedOximgUrl({ baseUrl: BASE, format: "webp" }, SIGNING, {
      src: "/cat.jpg",
      width: 640,
    });
    const sig = signResizePath("/resize/640/8192/cat.jpg@webp", SIGNING);
    expect(url).toBe(`${BASE}/${sig}/resize/640/8192/cat.jpg@webp`);
  });

  it("strips a trailing slash from baseUrl", () => {
    const url = signedOximgUrl({ baseUrl: `${BASE}/` }, SIGNING, {
      src: "cat.jpg",
      width: 640,
    });
    expect(url.startsWith(`${BASE}/`)).toBe(true);
    expect(url).not.toContain("//resize");
  });

  it("honors a custom heightBound and toFile", () => {
    const url = signedOximgUrl(
      { baseUrl: BASE, heightBound: 400, toFile: (s) => s.split("/").pop() as string },
      SIGNING,
      { src: "/deep/photo.jpg", width: 200 },
    );
    const sig = signResizePath("/resize/200/400/photo.jpg", SIGNING);
    expect(url).toBe(`${BASE}/${sig}/resize/200/400/photo.jpg`);
  });
});

describe("createSignedOximgUrlBuilder", () => {
  it("curries options and key into a (props) => url function", () => {
    const build = createSignedOximgUrlBuilder({ baseUrl: BASE }, SIGNING);
    expect(build({ src: "/cat.jpg", width: 640 })).toBe(
      signedOximgUrl({ baseUrl: BASE }, SIGNING, { src: "/cat.jpg", width: 640 }),
    );
  });
});
