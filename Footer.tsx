import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand"><strong><i>ASCENTRA</i></strong><p>|Aomm|</p><span>Powered by SPHEREx · Explore the Universe in 102 Colours</span></div>
        <div className="footer-note">An independent public exploration interface.<br />Not an official NASA product.</div>
        <div className="footer-links"><Link href="/research">Scientific research</Link><Link href="/intelligence">Cosmic intelligence</Link><Link href="/discoveries">Discoveries</Link><Link href="/cosmic-explorer">Cosmic Explorer</Link><Link href="/about">About the mission</Link><Link href="/sources">Data &amp; methodology</Link><a href="https://www.nasa.gov/spherex/" target="_blank" rel="noreferrer">NASA SPHEREx ↗</a></div>
      </div>
      <div className="footer-citation">Data provided by NASA/IPAC IRSA. SPHEREx data acknowledgement and release DOIs are listed in <Link href="/sources">Data &amp; Sources</Link>.</div>
    </footer>
  );
}
