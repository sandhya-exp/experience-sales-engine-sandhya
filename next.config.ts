import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide Next.js's floating dev-tools button (bottom-left "N"). It's a developer
  // aid, not part of the product, and it sat on top of the sidebar's date.
  // Flip to true (or remove) if you want route info / restart back while building.
  devIndicators: false,
  async redirects() {
    // Customer-facing name is "Talk to Sales"; the route keeps its internal path.
    return [{ source: "/talk-to-sales", destination: "/inquire", permanent: false }];
  },
};

export default nextConfig;
