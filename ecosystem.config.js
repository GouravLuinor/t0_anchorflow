/**
 * PM2 process definition — the production runtime (context.md §5: Node
 * standalone + PM2 behind nginx, no Docker in production).
 *
 * The build is `output: "standalone"`, so the server is the emitted
 * `.next/standalone/server.js` with `public/` and `.next/static/` staged in —
 * the same artifact the Dockerfile ships and the Playwright webServer boots.
 * Port 3004 is pinned here as well, so it can never drift to 3000 (reserved
 * for the website).
 *
 * Usage (deploy user only):
 *   npm run build
 *   pm2 start ecosystem.config.js          # first boot
 *   pm2 restart anchor-norai               # every later release
 */
module.exports = {
  apps: [
    {
      name: "anchor-norai",
      script: "node .next/standalone/server.js",
      cwd: "/var/www/anchorflow",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3004,
        HOSTNAME: "127.0.0.1",
      },
    },
  ],
};
