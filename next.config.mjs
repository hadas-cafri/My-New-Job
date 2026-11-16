// Set BASE_PATH (for example "/my-job-dashboard") when the site is published under a sub-path,
// as on GitHub Pages. Left unset, the site is served from the root (npm run dev, e2e).
const basePath = process.env.BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static site: no server. The browser talks to Airtable directly (token entered in the UI).
  output: "export",
  poweredByHeader: false,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
};

export default nextConfig;
