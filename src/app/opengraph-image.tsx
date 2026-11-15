import { ImageResponse } from "next/og";

export const alt = "ASCENTRA · Explore the Universe in 102 Colours";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const stars = Array.from({ length: 54 }, (_, index) => ({
    left: `${(index * 193 + 37) % 1180}px`,
    top: `${(index * 127 + 19) % 610}px`,
    size: index % 9 === 0 ? 3 : 2,
    opacity: 0.22 + (index % 6) * 0.1,
  }));

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", overflow: "hidden", background: "radial-gradient(ellipse at 79% 41%, rgba(102, 70, 160, .38), transparent 36%), radial-gradient(ellipse at 70% 75%, rgba(30, 126, 161, .2), transparent 34%)", backgroundColor: "#050916", color: "#e8f1ff", fontFamily: "Arial, sans-serif" }}>
      {stars.map((star, index) => <div key={index} style={{ position: "absolute", left: star.left, top: star.top, width: star.size, height: star.size, borderRadius: 9, background: "#c9eaff", opacity: star.opacity }} />)}
      <div style={{ position: "absolute", right: 76, top: 112, width: 350, height: 350, borderRadius: "50%", border: "1px solid rgba(125, 177, 222, .19)", boxShadow: "0 0 70px rgba(96, 119, 193, .11), inset 0 0 80px rgba(94, 95, 168, .1)", display: "flex" }} />
      <div style={{ position: "absolute", right: 126, top: 162, width: 250, height: 250, borderRadius: "50%", border: "1px solid rgba(182, 139, 222, .2)", transform: "rotate(-28deg) scaleY(.43)", display: "flex" }} />
      <div style={{ position: "absolute", right: 218, top: 254, width: 62, height: 62, borderRadius: "50%", background: "radial-gradient(circle at 38% 34%, #effaff, #8fc7f0 25%, #826eb7 62%, transparent 100%)", boxShadow: "0 0 46px rgba(122, 177, 239, .58)", display: "flex" }} />
      <div style={{ position: "absolute", left: 82, top: 78, color: "#8eddf0", fontSize: 18, letterSpacing: 7, display: "flex" }}>SPHEREx · SKY CHRONICLES</div>
      <div style={{ position: "absolute", left: 78, top: 160, fontSize: 82, fontWeight: 700, letterSpacing: 3, color: "#edf5ff", display: "flex" }}>ASCENTRA</div>
      <div style={{ position: "absolute", left: 84, top: 264, fontSize: 25, color: "#c0b0ef", letterSpacing: 1, display: "flex" }}>Explore the Universe in 102 Colours</div>
      <div style={{ position: "absolute", left: 85, top: 350, width: 370, height: 1, background: "linear-gradient(90deg, rgba(105, 209, 232, .8), rgba(150, 126, 205, .35), transparent)", display: "flex" }} />
      <div style={{ position: "absolute", left: 85, top: 382, fontSize: 16, color: "#98a9c3", letterSpacing: 2, display: "flex" }}>NASA/IPAC IRSA · PUBLIC INFRARED OBSERVATIONS</div>
      <div style={{ position: "absolute", left: 85, top: 421, fontSize: 16, color: "#98a9c3", letterSpacing: 2, display: "flex" }}>SCIENTIFIC EXPLORATION · PROCEDURAL COSMIC SIMULATION</div>
      <div style={{ position: "absolute", left: 85, bottom: 52, fontSize: 13, color: "#72849e", letterSpacing: 3, display: "flex" }}>INDEPENDENT PUBLIC-FACING EXPLORATION INTERFACE</div>
    </div>,
    { ...size },
  );
}
