import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "background-music";
const PREFERRED_PATH = "walk.mp3";
const MUSIC_VOLUME = 0.35;
const HOST_ID = "global-background-music-host";
const BUTTON_ID = "global-background-music-button";
const AUDIO_ID = "global-background-music-audio";
const STYLE_ID = "global-background-music-style";
const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`;

export function BackgroundMusic() {
  useEffect(() => {
    let cancelled = false;
    let audio: HTMLAudioElement | null = null;
    let button: HTMLButtonElement | null = null;
    let host: HTMLDivElement | null = null;
    let style: HTMLStyleElement | null = null;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      document.getElementById(HOST_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();

      style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        @keyframes musicBubblePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(45,212,191,.42), 0 0 18px rgba(45,212,191,.55), 0 6px 18px rgba(0,0,0,.35); }
          50% { transform: scale(1.11); box-shadow: 0 0 0 7px rgba(45,212,191,.08), 0 0 30px rgba(45,212,191,.78), 0 0 52px rgba(45,212,191,.32), 0 6px 18px rgba(0,0,0,.35); }
        }
        @keyframes musicIconBeat {
          0%, 100% { transform: scale(1) rotate(0deg); }
          20% { transform: scale(1.16) rotate(-4deg); }
          40% { transform: scale(1.04) rotate(4deg); }
          60% { transform: scale(1.14) rotate(-3deg); }
        }
        @keyframes musicBubbleRing {
          0% { opacity: .9; transform: scale(.82); }
          70% { opacity: .25; }
          100% { opacity: 0; transform: scale(1.85); }
        }
        @keyframes musicBubbleWave {
          0% { opacity: 0; transform: scale(.55) translateX(-2px); }
          25% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.18) translateX(8px); }
        }
        @keyframes musicBubbleNote {
          0% { opacity: 0; transform: translate(0, 8px) scale(.65) rotate(-8deg); }
          18% { opacity: 1; }
          100% { opacity: 0; transform: translate(8px, -28px) scale(1.05) rotate(12deg); }
        }
      `;
      document.head.appendChild(style);

      host = document.createElement("div");
      host.id = HOST_ID;
      Object.assign(host.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "2147483647", overflow: "visible" });

      audio = document.createElement("audio");
      audio.id = AUDIO_ID;
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = MUSIC_VOLUME;

      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Spustit hudbu");
      button.setAttribute("title", "Spustit hudbu");
      button.innerHTML = ICON;
      Object.assign(button.style, { position: "fixed", right: "16px", bottom: "16px", width: "40px", height: "40px", minWidth: "40px", minHeight: "40px", padding: "0", margin: "0", borderRadius: "9999px", border: "1px solid rgba(255,255,255,.18)", background: "#6b7280", color: "#fff", display: "grid", placeItems: "center", boxSizing: "border-box", cursor: "pointer", pointerEvents: "auto", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", zIndex: "2147483647", boxShadow: "0 5px 18px rgba(0,0,0,.35)", transition: "background .25s ease, box-shadow .25s ease, transform .25s ease", overflow: "visible", willChange: "transform, box-shadow" });

      const rings = ["-4px", "-9px", "-14px"].map((inset, i) => {
        const el = document.createElement("span");
        Object.assign(el.style, { position: "absolute", inset, borderRadius: "50%", border: i === 0 ? "2px solid rgba(94,234,212,.72)" : "1px solid rgba(94,234,212,.38)", pointerEvents: "none", opacity: "0", transformOrigin: "center", willChange: "transform, opacity" });
        button!.appendChild(el);
        return el;
      });

      const waves = [0, 1, 2].map(i => {
        const el = document.createElement("span");
        Object.assign(el.style, { position: "absolute", right: `${-7 - i * 5}px`, top: `${8 - i * 2}px`, width: `${7 + i * 4}px`, height: `${16 + i * 5}px`, border: "2px solid rgba(94,234,212,.9)", borderLeftColor: "transparent", borderTopColor: "transparent", borderBottomColor: "transparent", borderRadius: "0 999px 999px 0", pointerEvents: "none", opacity: "0", transformOrigin: "left center", willChange: "transform, opacity" });
        button!.appendChild(el);
        return el;
      });

      const notes = ["♪", "♫", "♩"].map((symbol, i) => {
        const el = document.createElement("span");
        el.textContent = symbol;
        Object.assign(el.style, { position: "absolute", right: `${-8 - i * 7}px`, top: `${-15 - i * 4}px`, color: "rgba(94,234,212,.98)", fontSize: `${11 + i * 2}px`, lineHeight: "1", fontWeight: "700", pointerEvents: "none", opacity: "0", textShadow: "0 0 10px rgba(45,212,191,.9)", willChange: "transform, opacity" });
        button!.appendChild(el);
        return el;
      });

      const icon = button.querySelector("svg") as SVGElement | null;
      if (icon) Object.assign(icon.style, { position: "relative", zIndex: "10", transformOrigin: "center", willChange: "transform" });

      host.append(audio, button);
      document.documentElement.appendChild(host);

      const visual = (on: boolean) => {
        if (!button) return;
        button.setAttribute("aria-label", on ? "Zastavit hudbu" : "Spustit hudbu");
        button.setAttribute("title", on ? "Zastavit hudbu" : "Spustit hudbu");
        if (on) {
          button.style.background = "hsl(171 72% 55%)";
          button.style.color = "#07151a";
          button.style.borderColor = "rgba(94,234,212,.9)";
          button.style.boxShadow = "0 0 0 1px rgba(94,234,212,.25), 0 0 18px rgba(45,212,191,.55), 0 0 42px rgba(45,212,191,.28), 0 6px 18px rgba(0,0,0,.35)";
          button.style.animation = "musicBubblePulse .95s ease-in-out infinite";
          if (icon) icon.style.animation = "musicIconBeat .95s ease-in-out infinite";
          rings.forEach((e, i) => { e.style.opacity = i === 0 ? "1" : ".75"; e.style.animation = `musicBubbleRing 1.65s ease-out ${i * .36}s infinite`; });
          waves.forEach((e, i) => { e.style.opacity = ".95"; e.style.animation = `musicBubbleWave .9s ease-out ${i * .18}s infinite`; });
          notes.forEach((e, i) => { e.style.opacity = ".98"; e.style.animation = `musicBubbleNote 1.8s ease-out ${i * .42}s infinite`; });
        } else {
          button.style.background = "#6b7280";
          button.style.color = "#fff";
          button.style.borderColor = "rgba(255,255,255,.18)";
          button.style.boxShadow = "0 5px 18px rgba(0,0,0,.35)";
          button.style.animation = "none";
          if (icon) icon.style.animation = "none";
          [...rings, ...waves, ...notes].forEach(e => { e.style.opacity = "0"; e.style.animation = "none"; });
        }
      };
      const sync = () => visual(Boolean(audio && !audio.paused && !audio.ended));
      const onState = () => sync();
      const onError = () => { sync(); button?.setAttribute("title", "Skladbu se nepodařilo načíst ze Supabase."); };
      audio.addEventListener("play", onState);
      audio.addEventListener("playing", onState);
      audio.addEventListener("pause", onState);
      audio.addEventListener("ended", onState);
      audio.addEventListener("error", onError);

      const toggle = async () => {
        if (!audio) return;
        if (audio.paused) {
          try { audio.muted = false; audio.volume = MUSIC_VOLUME; await audio.play(); sync(); }
          catch (error) { console.error("Background music playback failed", error); sync(); button?.setAttribute("title", "Přehrávání bylo prohlížečem zablokováno."); }
        } else { audio.pause(); sync(); }
      };
      button.addEventListener("click", toggle);
      visual(false);

      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(PREFERRED_PATH).data.publicUrl;
      if (cancelled || !audio) return;
      audio.src = publicUrl;
      audio.load();
      const { data: files } = await supabase.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "asc" } });
      if (cancelled || !audio) return;
      const audioFiles = (files ?? []).filter(file => /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name));
      const file = audioFiles.find(item => item.name.toLowerCase() === PREFERRED_PATH) ?? audioFiles[0];
      if (file && file.name !== PREFERRED_PATH) { audio.src = supabase.storage.from(BUCKET).getPublicUrl(file.name).data.publicUrl; audio.load(); }

      try { audio.muted = false; audio.volume = MUSIC_VOLUME; await audio.play(); sync(); } catch { sync(); }

      cleanup = () => {
        button?.removeEventListener("click", toggle);
        audio?.removeEventListener("play", onState);
        audio?.removeEventListener("playing", onState);
        audio?.removeEventListener("pause", onState);
        audio?.removeEventListener("ended", onState);
        audio?.removeEventListener("error", onError);
        audio?.pause();
        style?.remove();
      };
    };

    void setup();
    return () => { cancelled = true; cleanup?.(); host?.remove(); document.getElementById(HOST_ID)?.remove(); document.getElementById(STYLE_ID)?.remove(); };
  }, []);

  return null;
}
