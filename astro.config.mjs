import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";
import config from "./src/config/config.json";
import { fileURLToPath, URL } from "node:url";

// https://astro.build/config
export default defineConfig({
  build: {
    // The complete public stylesheet is only ~13 KB. Inlining it removes the
    // sole render-blocking request on first visits and keeps the hero's paint
    // on the initial HTML response.
    inlineStylesheets: "always",
  },
  fonts: [
    {
      name: "Inter",
      cssVariable: "--font-inter",
      provider: fontProviders.google(),
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["sans-serif"],
    },
  ],
  image: {
    domains: ["australianweddingcelebrants.com.au"],
    remotePatterns: [{ protocol: "https" }],
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
  site: config.site.base_url ? config.site.base_url : "http://examplesite.com",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  integrations: [
    react(),
    sitemap({
      filter: (page) => page !== "https://australianweddingcelebrants.com.au/submit/",
    }),
    mdx(),
  ],
  markdown: {
    shikiConfig: {
      theme: "one-dark-pro",
      wrap: true,
    },
  },
});
