import type { ImageMetadata } from "astro";

export function outputImageFormat(image: ImageMetadata): "svg" | "webp" {
  return image.format === "svg" ? "svg" : "webp";
}
