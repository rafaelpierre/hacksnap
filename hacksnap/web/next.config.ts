import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  // The small shared stylesheet should not add a round trip before mobile paint.
  experimental: { inlineCss: true },
  outputFileTracingIncludes: {"/*": ["./certs/supabase-ca.crt"]},
  async headers() {
    return [{source: "/:path*", headers: [
      {key: "X-Content-Type-Options", value: "nosniff"},
      {key: "Referrer-Policy", value: "strict-origin-when-cross-origin"},
      {key: "X-Frame-Options", value: "DENY"},
      {key: "Link", value: '<https://hacksnap.live/.well-known/api-catalog>; rel="api-catalog"'},
    ]}];
  },
};
export default config;
