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
      <body>
        <div className="app-shell">
          <header className="app-header">
            <div>
              <h1>Fog of Travel</h1>
              <p className="subtitle">
                Google Maps Timeline &rarr; fog-of-war map
              </p>
            </div>
            <div className="header-actions">
              <span className="pill">Beta</span>
            </div>
          </header>
          <main>
            <Suspense fallback={null}>{children}</Suspense>
          </main>
        </div>
      </body>
    </html>
  );
}
