"use client";

import { TriangleAlert } from "lucide-react";

/**
 * Last-resort boundary for a failure in the root layout itself. It renders its
 * own <html>/<body> because the real ones are gone, so it carries the token
 * ladder inline — the same canvas/ink/lime values from app/globals.css.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c0e0b",
          color: "#eceee4",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: "28rem", padding: "2rem", textAlign: "center" }}>
          <TriangleAlert
            aria-hidden="true"
            style={{ height: 32, width: 32, color: "#fda4af" }}
          />
          <h1
            style={{
              margin: "1rem 0 0.5rem",
              fontSize: "1.25rem",
              fontWeight: 600,
              letterSpacing: "-0.025em",
            }}
          >
            Anchorflow could not start
          </h1>
          <p style={{ color: "#a3a89a", fontSize: "0.875rem", lineHeight: 1.6 }}>
            The shell itself failed to render. Reload the page — your saved
            workflow is stored locally and is unaffected.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              height: "2.25rem",
              padding: "0 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #2e3328",
              background: "#1b1e18",
              color: "#e4e4e7",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
