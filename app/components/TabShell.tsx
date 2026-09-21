"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

interface TabShellProps {
  radar: ReactNode;
  positions: ReactNode;
  history: ReactNode;
  openCount: number;
}

const TABS = [
  { key: "radar", label: "Radar" },
  { key: "positions", label: "Posisi aktif" },
  { key: "history", label: "Riwayat" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function TabShell({ radar, positions, history, openCount }: TabShellProps) {
  const [active, setActive] = useState<TabKey>("radar");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const content: Record<TabKey, ReactNode> = { radar, positions, history };
  const activeIndex = TABS.findIndex((t) => t.key === active);

  function move(to: number) {
    const next = (to + TABS.length) % TABS.length;
    setActive(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight") move(activeIndex + 1);
    else if (e.key === "ArrowLeft") move(activeIndex - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(TABS.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div className="shell">
      <div className="dock">
        <div className="dock-track" role="tablist" aria-label="Pilih tampilan" onKeyDown={onKeyDown}>
          <span
            className="dock-thumb"
            aria-hidden="true"
            style={{ transform: `translateX(${activeIndex * 100}%)` }}
          />
          {TABS.map((tab, i) => {
            const selected = tab.key === active;
            const count = tab.key === "positions" && openCount > 0 ? openCount : null;
            return (
              <button
                key={tab.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${tab.key}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.key}`}
                tabIndex={selected ? 0 : -1}
                className="dock-tab"
                onClick={() => setActive(tab.key)}
              >
                {tab.label}
                {count !== null && <span className="dock-count num">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div
        key={active}
        id={`panel-${active}`}
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
        className="panel"
      >
        {content[active]}
      </div>
    </div>
  );
}
