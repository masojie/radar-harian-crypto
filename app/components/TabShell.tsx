"use client";

import { useState, type ReactNode } from "react";

interface TabShellProps {
  radar: ReactNode;
  positions: ReactNode;
  history: ReactNode;
  openCount: number;
}

const TABS = [
  { key: "radar", label: "Radar" },
  { key: "positions", label: "Posisi Aktif" },
  { key: "history", label: "Riwayat" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function TabShell({ radar, positions, history, openCount }: TabShellProps) {
  const [active, setActive] = useState<TabKey>("radar");

  const content: Record<TabKey, ReactNode> = { radar, positions, history };

  return (
    <div>
      <nav
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--line)",
          padding: "0 20px",
          position: "sticky",
          top: "calc(64px + env(safe-area-inset-top, 0px))",
          background: "var(--bg)",
          zIndex: 4,
        }}
      >
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          const badge = tab.key === "positions" ? openCount : null;
          return (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                color: isActive ? "var(--ink)" : "var(--ink-dim)",
                fontWeight: isActive ? 600 : 500,
                fontSize: 13.5,
                padding: "14px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 7,
                transition: "color 0.15s ease, border-color 0.15s ease",
              }}
            >
              {tab.label}
              {badge !== null && badge > 0 && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    background: "var(--bg-panel)",
                    color: "var(--ink-dim)",
                    borderRadius: 999,
                    padding: "1px 7px",
                    lineHeight: 1.6,
                  }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "20px" }}>{content[active]}</div>
    </div>
  );
}
