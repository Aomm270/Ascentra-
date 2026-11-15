"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Menu, X } from "lucide-react";
import { Brand } from "@/components/Brand";
import { API_BASE } from "@/lib/api";

const links = [
  ["Home", "/"],
  ["The Mission", "/about"],
  ["Scientific Research", "/research"],
  ["SPHEREx Observatory", "/research#observatory"],
  ["Cosmic Intelligence", "/intelligence"],
  ["Discoveries", "/discoveries"],
] as const;

export function Navigation() {
  const path = usePathname();
  const activeHref = links.find(([, href]) => path === href.split("#")[0])?.[1];
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4500) })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(() => active && setOnline(true))
      .catch(() => active && setOnline(false));
    return () => { active = false; };
  }, []);
  useEffect(() => { setOpen(false); }, [path]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <button className="mobile-menu-button" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="primary-navigation">
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
        <nav id="primary-navigation" className={`main-nav ${open ? "is-open" : ""}`} aria-label="Main navigation">
          {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)} className={activeHref === href ? "active" : ""}>{label}</Link>)}
          <Link href="/cosmic-explorer" onClick={() => setOpen(false)} className={`cosmic-nav-link ${path === "/cosmic-explorer" ? "active" : ""}`}><span className="cosmic-nav-pulse" /> Cosmic Explorer</Link>
        </nav>
        <div className="connection-pill" aria-live="polite" title="ASCENTRA API status. IRSA connectivity is checked when you run an archive query.">
          <span className={`status-led ${online === false ? "offline" : online ? "online" : "checking"}`} />
          <Activity size={13} />
          <span>{online === false ? "API offline" : online ? "API online" : "Connecting"}</span>
        </div>
      </div>
    </header>
  );
}
