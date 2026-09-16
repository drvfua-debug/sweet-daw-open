import type { NextConfig } from "next";

const staticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (staticExport ? "/lando_hp/sdaw" : "");
const basePath = rawBasePath.endsWith("/") ? rawBasePath.slice(0, -1) : rawBasePath;
const noStoreHeaders = [
  {
    key: "Cache-Control",
    value: "no-store, no-cache, must-revalidate, proxy-revalidate",
  },
  {
    key: "Pragma",
    value: "no-cache",
  },
  {
    key: "Expires",
    value: "0",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  output: staticExport ? "export" : undefined,
  trailingSlash: staticExport,
  images: {
    unoptimized: staticExport,
  },
  ...(staticExport
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/",
              headers: noStoreHeaders,
            },
            {
              source: "/daw/:path*",
              headers: noStoreHeaders,
            },
            {
              source: "/manifest.webmanifest",
              headers: noStoreHeaders,
            },
            {
              source: "/sweet-daw-build.json",
              headers: noStoreHeaders,
            },
          ];
        },
      }),
};

export default nextConfig;
