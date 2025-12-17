"use client";

import "./globals.css";
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <div>
              <h1>Fog of Travel</h1>
              <p className="subtitle">
                Google Maps Timeline → RPG-style fog-of-war map
              </p>
            </div>
            <div className="header-actions">
              <span className="pill">MVP</span>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
