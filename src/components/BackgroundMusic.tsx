import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "background-music";
const PREFERRED_PATH = "walk.mp3";
const MUSIC_VOLUME = 0.35;
const HOST_ID = "global-background-music-host";
const BUTTON_ID = "global-background-music-button";
const AUDIO_ID = "global-background-music-audio";

const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`;

export function BackgroundMusic() {
  useEffect(() => {
    let cancelled = false;
    let audio: HTMLAudioElement | null = null;
    let button: HTMLButtonElement | null = null;
    let host: HTMLDivElement | null = null;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      document.getElementById(HOST_ID)?.remove();
      host = document.createElement("div");
      host.id = HOST_ID;
      Object.assign(host.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "2147483647", overflow: "visible" });

      audio = document.createElement("audio");
      audio.id = AUDIO_ID;
      audio.loop = true;
      audio.preload = "auto";
      audio.playsInline = true;
      audio.volume = MUSIC_VOLUME;

      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Spustit hudbu");
      button.setAttribute("title", "Spustit hudbu");
      button.innerHTML = ICON;
      Object.assign(button.style, { position: "fixed", right: "16px", bottom: "16px", width: "46px", height: "46px", minWidth: "46px", minHeight: "46px", padding: "0", margin: "0", borderRadius: "9999px", border: "1px solid rgba(255,255,255,.18)", background: "#6b7280", color: "#fff", display: "grid", placeItems: "center", boxSizing: "border-box", cursor: "pointer", pointerEvents: "auto", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", zIndex: "2147483647", boxShadow: "0 5px 20px rgba(0,0,0,.35)", transition: "background .25s ease, box-shadow .25s ease, transform .25s ease" });

      const rings = ["-5px", "-10px"].map((inset, index) => {
        const ring = document.createElement("span");
        Object.assign(ring.style, { position: "absolute", inset, borderRadius: "9999px", border: index === 0 ? "2px solid rgba(94,234,212,.55)" : "1px solid rgba(94,234,212,.28)", pointerEvents: "none", opacity: "0" });
        button!.appendChild(ring);
        return ring;
      });

      host.append(audio, button);
      document.documentElement.appendChild(host);

      const setPlayingVisual = (isPlaying: boolean) => {
        if (!button) return;
        button.setAttribute("aria-label", isPlaying ? "Zastavit hudbu" : "Spustit hudbu");
        button.setAttribute("title", isPlaying ? "Zastavit hudbu" : "Spustit hudbu");
        if (isPlaying) {
          button.style.background = "hsl(171 72% 55%)";
          button.style.color = "#07151a";
          button.style.borderColor = "rgba(94,234,212,.7)";
          button.style.boxShadow = "0 0 0 1px rgba(94,234,212,.2), 0 0 26px rgba(45,212,191,.55), 0 6px 20px rgba(0,0,0,.35)";
          button.style.animation = "musicBubblePulse 1.6s ease-in-out infinite";
          rings.forEach((ring, index) => { ring.style.opacity = index === 0 ? "1" : ".7"; ring.style.animation = `musicBubbleRing 1.8s ease-out ${index * 0.55}s infinite`; });
        } else {
          button.style.background = "#6b7280";
          button.style.color = "#fff";
          button.style.borderColor = "rgba(255,255,255,.18)";
          button.style.boxShadow = "0 5px 20px rgba(0,0,0,.35)";
          button.style.animation = "none";
          rings.forEach((ring) => { ring.style.opacity = "0"; ring.style.animation = "none"; });
        }
      };

      const sync = () => setPlayingVisual(Boolean(audio && !audio.paused && !audio.ended));
      const onPlay = () => sync();
      const onPause = () => sync();
      const onEnded = () => sync();
      const onError = () => { sync(); button?.setAttribute("title", "Skladbu se nepodařilo načíst ze Supabase."); };
      audio.addEventListener("play", onPlay);
      audio.addEventListener("playing", onPlay);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      const toggle = async () => {
        if (!audio) return;
        if (audio.paused) {
          try { audio.muted = false; audio.volume = MUSIC_VOLUME; await audio.play(); sync(); }
          catch (error) { console.error("Background music playback failed", error); sync(); button?.setAttribute("title", "Přehrávání bylo prohlížečem zablokováno."); }
        } else { audio.pause(); sync(); }
      };
      button.addEventListener("click", toggle);
      setPlayingVisual(false);

      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(PREFERRED_PATH).data.publicUrl;
      if (cancelled || !audio) return;
      audio.src = publicUrl;
      audio.load();

      const { data: files } = await supabase.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "asc" } });
      if (cancelled || !audio) return;
      const audioFiles = (files ?? []).filter((file) => /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name));
      const file = audioFiles.find((item) => item.name.toLowerCase() === PREFERRED_PATH) ?? audioFiles[0];
      if (file && file.name !== PREFERRED_PATH) { audio.src = supabase.storage.from(BUCKET).getPublicUrl(file.name).data.publicUrl; audio.load(); }
      try { audio.muted = false; audio.volume = MUSIC_VOLUME; await audio.play(); sync(); } catch { sync(); }

      cleanup = () => {
        button?.removeEventListener("click", toggle);
        audio?.removeEventListener("play", onPlay);
        audio?.removeEventListener("playing", onPlay);
        audio?.removeEventListener("pause", onPause);
        audio?.removeEventListener("ended", onEnded);
        audio?.removeEventListener("error", onError);
        audio?.pause();
      };
    };

    void setup();
    return () => { cancelled = true; cleanup?.(); host?.remove(); document.getElementById(HOST_ID)?.remove(); };
  }, []);

  return null;
}
