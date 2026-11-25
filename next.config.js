/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
    // Single build worker — the production server has 1GB RAM and parallel
    // page prerendering OOMs it. Harmless on bigger machines, just slower.
    cpus: 1,
  },
  // The 1GB server prerenders slowly under swap pressure; the default 60s
  // per-page timeout is too strict there.
  staticPageGenerationTimeout: 300,
  // The old global "Lead Integrations" module is gone — every push is now set up
  // per college under College API Push. Bookmarks to the old pages land there.
  async redirects() {
    return [
      {
        source: '/dashboard/super-admin/configurations/lead-integrations/:path*',
        destination: '/dashboard/super-admin/configurations/college-integrations',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Blocks the app from being embedded in an iframe (clickjacking)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stops browsers guessing content types (MIME sniffing)
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Never leak internal URLs (which contain lead ids) to other sites
          { key: 'Referrer-Policy', value: 'same-origin' },
          // Camera and microphone are never needed. Geolocation IS, for the
          // attendance check-in geofence — `(self)` grants it to our own
          // origin only, so an embedded third party still cannot ask for it.
          // An empty `geolocation=()` denies it to us too, which silently
          // breaks check-in for every WFO agent.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
