import { describe, expect, it } from "vitest";

import {
  buildResizePath,
  createOximgLoader,
  encodeResizePath,
  OXIMG_MAX_DIM,
  oximgUrl,
} from "../src/index.js";

const BASE = "https://img.example.com";

describe("createOximgLoader", () => {
  it("builds a width-only fit URL with the default 8192 height bound", () => {
    const loader = createOximgLoader({ baseUrl: BASE });
    expect(loader({ src: "/cat.jpg", width: 640 })).toBe(`${BASE}/resize/640/8192/cat.jpg`);
  });

  it("ignores quality (oximg configures it server-side)", () => {
    const loader = createOximgLoader({ baseUrl: BASE });
    const withQ = loader({ src: "/cat.jpg", width: 640, quality: 50 });
    const withoutQ = loader({ src: "/cat.jpg", width: 640 });
    expect(withQ).toBe(withoutQ);
    expect(withQ).not.toContain("q=");
  });

  it("strips a trailing slash from baseUrl", () => {
    const loader = createOximgLoader({ baseUrl: `${BASE}/` });
    expect(loader({ src: "cat.jpg", width: 320 })).toBe(`${BASE}/resize/320/8192/cat.jpg`);
  });

  it("strips multiple trailing slashes", () => {
    const loader = createOximgLoader({ baseUrl: `${BASE}///` });
    expect(loader({ src: "cat.jpg", width: 320 })).toBe(`${BASE}/resize/320/8192/cat.jpg`);
  });

  it("passes src through unchanged when there is no leading slash", () => {
    const loader = createOximgLoader({ baseUrl: BASE });
    expect(loader({ src: "nested-but-flat.png", width: 100 })).toBe(
      `${BASE}/resize/100/8192/nested-but-flat.png`,
    );
  });

  it("honors a custom heightBound", () => {
    const loader = createOximgLoader({ baseUrl: BASE, heightBound: 400 });
    expect(loader({ src: "/cat.jpg", width: 640 })).toBe(`${BASE}/resize/640/400/cat.jpg`);
  });

  it("appends an @fmt token when a format is forced", () => {
    const loader = createOximgLoader({ baseUrl: BASE, format: "avif" });
    expect(loader({ src: "/cat.jpg", width: 800 })).toBe(`${BASE}/resize/800/8192/cat.jpg@avif`);
  });

  it("supports every known format token", () => {
    for (const format of ["webp", "avif", "jpeg", "png"] as const) {
      const loader = createOximgLoader({ baseUrl: BASE, format });
      expect(loader({ src: "/x.bin", width: 10 })).toBe(`${BASE}/resize/10/8192/x.bin@${format}`);
    }
  });

  it("applies a custom toFile mapping", () => {
    const loader = createOximgLoader({
      baseUrl: BASE,
      toFile: (src) => src.split("/").pop() as string,
    });
    expect(loader({ src: "/deep/nested/path/photo.jpg", width: 200 })).toBe(
      `${BASE}/resize/200/8192/photo.jpg`,
    );
  });

  it("validates baseUrl eagerly at creation time", () => {
    expect(() => createOximgLoader({ baseUrl: "" })).toThrow(/baseUrl is required/);
  });

  it("rounds fractional widths", () => {
    const loader = createOximgLoader({ baseUrl: BASE });
    expect(loader({ src: "/cat.jpg", width: 639.6 })).toBe(`${BASE}/resize/640/8192/cat.jpg`);
  });

  it("clamps width above the oximg maximum", () => {
    const loader = createOximgLoader({ baseUrl: BASE });
    expect(loader({ src: "/cat.jpg", width: 99999 })).toBe(
      `${BASE}/resize/${OXIMG_MAX_DIM}/8192/cat.jpg`,
    );
  });

  it("clamps heightBound above the oximg maximum", () => {
    const loader = createOximgLoader({ baseUrl: BASE, heightBound: 99999 });
    expect(loader({ src: "/cat.jpg", width: 640 })).toBe(
      `${BASE}/resize/640/${OXIMG_MAX_DIM}/cat.jpg`,
    );
  });
});

describe("oximgUrl percent-encoding", () => {
  it("encodes spaces and unicode in the filename", () => {
    expect(oximgUrl({ baseUrl: BASE }, { src: "/café photo.jpg", width: 300 })).toBe(
      `${BASE}/resize/300/8192/caf%C3%A9%20photo.jpg`,
    );
  });

  it("keeps an @fmt suffix literal while encoding the name", () => {
    expect(oximgUrl({ baseUrl: BASE, format: "webp" }, { src: "/my pic.jpg", width: 300 })).toBe(
      `${BASE}/resize/300/8192/my%20pic.jpg@webp`,
    );
  });

  it("encodes a non-format @ inside the filename (photo@2x.jpg)", () => {
    // oximg only strips a *known* trailing token, so `@2x` stays part of
    // the name; the server percent-decodes it back before matching.
    expect(oximgUrl({ baseUrl: BASE }, { src: "/photo@2x.jpg", width: 300 })).toBe(
      `${BASE}/resize/300/8192/photo%402x.jpg`,
    );
  });

  it("encodes a non-format @ even when a real format token follows", () => {
    expect(oximgUrl({ baseUrl: BASE, format: "avif" }, { src: "/photo@2x.jpg", width: 300 })).toBe(
      `${BASE}/resize/300/8192/photo%402x.jpg@avif`,
    );
  });
});

describe("buildResizePath validation", () => {
  it("rejects an empty filename (e.g. src was just '/')", () => {
    expect(() => buildResizePath("", 100, 8192, undefined)).toThrow(/empty string/);
  });

  it("rejects interior slashes with a helpful message", () => {
    expect(() => buildResizePath("a/b.jpg", 100, 8192, undefined)).toThrow(/single path segment/);
  });

  it("rejects backslashes", () => {
    expect(() => buildResizePath("a\\b.jpg", 100, 8192, undefined)).toThrow(/single path segment/);
  });

  it("rejects query and fragment characters", () => {
    expect(() => buildResizePath("a?b.jpg", 100, 8192, undefined)).toThrow(/single path segment/);
    expect(() => buildResizePath("a#b.jpg", 100, 8192, undefined)).toThrow(/single path segment/);
  });

  it("rejects parent-directory traversal", () => {
    expect(() => buildResizePath("..", 100, 8192, undefined)).toThrow(/single path segment/);
    expect(() => buildResizePath("a..b", 100, 8192, undefined)).toThrow(/single path segment/);
  });

  it("rejects an unknown format token", () => {
    expect(() => buildResizePath("a.jpg", 100, 8192, "gif" as never)).toThrow(/unknown format/);
  });

  it("rejects a non-finite width", () => {
    expect(() => buildResizePath("a.jpg", Number.NaN, 8192, undefined)).toThrow(/finite number/);
    expect(() => buildResizePath("a.jpg", Infinity, 8192, undefined)).toThrow(/finite number/);
  });

  it("rejects a width below 1", () => {
    expect(() => buildResizePath("a.jpg", 0, 8192, undefined)).toThrow(/>= 1/);
    expect(() => buildResizePath("a.jpg", 0.4, 8192, undefined)).toThrow(/>= 1/);
  });

  it("rejects a heightBound below 1", () => {
    expect(() => buildResizePath("a.jpg", 100, 0, undefined)).toThrow(/>= 1/);
  });
});

describe("encodeResizePath", () => {
  it("leaves an already-safe path untouched", () => {
    expect(encodeResizePath("/resize/640/8192/cat.jpg")).toBe("/resize/640/8192/cat.jpg");
  });

  it("encodes the filename while preserving a trailing format token", () => {
    expect(encodeResizePath("/resize/1/1/a b@png")).toBe("/resize/1/1/a%20b@png");
  });
});
