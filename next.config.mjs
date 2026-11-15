/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static site: no server. The browser talks to Airtable directly (token entered in the UI).
  output: "export",
  poweredByHeader: false,
};

export default nextConfig;
