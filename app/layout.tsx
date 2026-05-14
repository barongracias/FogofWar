import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fog of Travel — Google Maps Timeline Fog-of-War Map",
  description:
    "Visualise your Google Maps Timeline as an RPG-style fog-of-war map. Explored areas light up; everywhere else stays under fog.",
  openGraph: {
    title: "Fog of Travel",
    description: "Your Google Maps Timeline as an interactive fog-of-war map.",
    type: "website"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=IBM+Plex+Mono:wght@400;500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <div className="app-shell">
          <header className="app-header">
            <div className="app-header__title">
              <h1>Fog of Travel</h1>
              <p className="subtitle">
                <span className="mono">Google Maps Timeline</span>
                <span className="rule-dash">—</span>
                <em>a fog-of-war chart</em>
              </p>
            </div>
            <div className="header-actions">
              <svg
                className="compass-rose"
                viewBox="0 0 64 64"
                aria-hidden="true"
              >
                <circle cx="32" cy="32" r="28" className="compass-ring" />
                <circle cx="32" cy="32" r="22" className="compass-ring compass-ring--inner" />
                <path d="M32 6 L36 32 L32 58 L28 32 Z" className="compass-needle" />
                <path d="M6 32 L32 28 L58 32 L32 36 Z" className="compass-needle compass-needle--alt" />
                <circle cx="32" cy="32" r="2" className="compass-pin" />
              </svg>
              <span className="pill">Beta · v0.1</span>
            </div>
          </header>
          <main>
            <Suspense fallback={null}>{children}</Suspense>
          </main>
          <footer className="app-footer">
            <span className="mono">N 0°00&apos; · E 0°00&apos;</span>
            <span className="rule-dash">·</span>
            <span>charted from personal location history</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
