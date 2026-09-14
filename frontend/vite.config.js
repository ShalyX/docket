import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves this repository below /docket/. Local development
  // keeps the root path so existing preview URLs continue to work.
  base: process.env.GITHUB_ACTIONS ? "/docket/" : "/",
});
