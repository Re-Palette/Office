/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The PDF route reads the vendored Japanese fonts from disk at request time,
  // so they must travel with the server bundle when this is deployed.
  outputFileTracingIncludes: {
    "/reports/[id]/pdf": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
