import "./interaktivni.css";

const PARTICLES = [
  { left: "6%", duration: "16s", delay: "0s", drift: "18px" },
  { left: "18%", duration: "21s", delay: "3s", drift: "-24px" },
  { left: "32%", duration: "18s", delay: "7s", drift: "12px" },
  { left: "47%", duration: "24s", delay: "1s", drift: "-16px" },
  { left: "61%", duration: "19s", delay: "9s", drift: "22px" },
  { left: "74%", duration: "22s", delay: "4s", drift: "-10px" },
  { left: "88%", duration: "17s", delay: "6s", drift: "14px" },
];

/**
 * Statické mřížkové pozadí + pomalý scan paprsek + pár driftujících částic.
 * Vše čisté CSS animace (transform/opacity), žádný JS tik ani canvas - drží
 * dojem "živého" systému bez zatížení hlavního vlákna.
 */
export function LiveBackground() {
  return (
    <>
      <div className="iw-grid" aria-hidden="true" />
      <div className="iw-scanline" aria-hidden="true" />
      {PARTICLES.map((particle, index) => (
        <div
          key={index}
          className="iw-particle"
          aria-hidden="true"
          style={{
            left: particle.left,
            animationDuration: particle.duration,
            animationDelay: particle.delay,
            ["--iw-drift-x" as string]: particle.drift,
          }}
        />
      ))}
    </>
  );
}
