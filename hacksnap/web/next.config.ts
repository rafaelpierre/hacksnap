import type { NextConfig } from "next";
import { ARTICLE_IMAGE_HOSTNAME } from "./lib/article-image-origin";

const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  images: {
    // Source images are already bounded to 1600px/WebP by the ingest pipeline.
    // Keep the on-demand optimizer's width and quality cache keys bounded too.
    deviceSizes: [384, 640, 750, 1080, 1600],
    imageSizes: [128, 256, 320],
    qualities: [75],
    maximumRedirects: 0,
    remotePatterns: [
      {
        protocol: "https",
        hostname: ARTICLE_IMAGE_HOSTNAME,
        port: "",
        pathname: "/articles/**",
        search: "",
      },
    ],
  },
  // Keep shared CSS cacheable across full-document visits.
  outputFileTracingIncludes: { "/*": ["./certs/supabase-ca.crt"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
