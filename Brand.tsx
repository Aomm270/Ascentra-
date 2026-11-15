import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand-lockup" aria-label="Ascentra home">
      <span className="brand-mark" aria-hidden="true"><span /></span>
      <span className="brand-type"><strong>ASCENTRA</strong><em>SPHEREx SKY CHRONICLES</em></span>
    </Link>
  );
}
