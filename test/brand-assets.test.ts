import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const brandRoot = "ui/public/vivi/brand";

it("keeps the approved Open Reader SVGs as the brand source of truth", () => {
  for (const file of [
    "vivi-icon.svg",
    "vivi-mark.svg",
    "vivi-lockup.svg",
    "vivi-readme.svg",
  ]) {
    const svg = readFileSync(`${brandRoot}/${file}`, "utf8");
    expect(svg).toContain("<title");
    expect(svg).toContain("<desc");
    expect(svg).toContain("#07111a");
    expect(svg).toContain("#54c4dc");
    expect(svg).toContain("#f0b35a");
    expect(svg).not.toContain("linearGradient");
    expect(svg).not.toContain("filter=");
  }

  expect(readFileSync(`${brandRoot}/vivi-readme.svg`, "utf8")).toContain(
    "LOCAL REVIEW ADAPTER",
  );
});

it("ships service icon, favicon, and README raster fallbacks at stable sizes", () => {
  for (const size of [16, 32, 64, 180, 192, 512]) {
    expect(pngDimensions(`${brandRoot}/vivi-icon-${size}.png`)).toEqual({
      width: size,
      height: size,
    });
  }

  expect(pngDimensions(`${brandRoot}/vivi-mark-512.png`)).toEqual({
    width: 512,
    height: 512,
  });
  expect(pngDimensions(`${brandRoot}/vivi-lockup.png`)).toEqual({
    width: 1120,
    height: 320,
  });
  expect(pngDimensions(`${brandRoot}/vivi-readme.png`)).toEqual({
    width: 1200,
    height: 300,
  });
  expect(existsSync(`${brandRoot}/favicon.ico`)).toBe(true);
});

it("connects the approved brand assets to README and browser chrome", () => {
  const readme = readFileSync("README.md", "utf8");
  const html = readFileSync("ui/index.html", "utf8");

  expect(readme).toContain('src="ui/public/vivi/brand/vivi-readme.svg"');
  expect(html).toContain('href="/vivi/brand/vivi-icon.svg"');
  expect(html).toContain('href="/vivi/brand/favicon.ico"');
  expect(html).toContain('href="/vivi/brand/vivi-icon-180.png"');
  expect(html).toContain('name="theme-color" content="#07111a"');
});

function pngDimensions(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}
