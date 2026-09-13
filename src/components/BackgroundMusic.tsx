import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "background-music";
const PREFERRED_PATH = "walk.mp3";
const MUSIC_VOLUME = 0.35;
const MUSIC_HOST_ID = "global-background-music-host";

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [hostReady, setHostReady] = useState(false);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const existing = document.getElementById(MUSIC_HOST_ID);
    const host = existing instanceof HTMLDivElement ? existing : document.createElement("div");
    host.id = MUSIC_HOST_ID;
    host.setAttribute("data-background-music-host", "true");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "2147483647",
      isolation: "isolate",
    });
    if (!existing) document.documentElement.appendChild(host);
    hostRef.current = host;
    setHostReady(true);

    return () => {
      setHostReady(false);
      host.remove();
      hostRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    let cancelled = false;
    const loadSong = async () => {
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(PREFERRED_PATH).data.publicUrl;
      if (!cancelled) setUrl(publicUrl);

      const { data: files } = await supabase.storage.from(BUCKET).list("", {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });
      if (cancelled) return;

      const audioFiles = (files ?? []).filter((file) => /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name));
      const file = audioFiles.find((item) => item.name.toLowerCase() === PREFERRED_PATH) ?? audioFiles[0];
      if (file) setUrl(supabase.storage.from(BUCKET).getPublicUrl(file.name).data.publicUrl);
      setError("");
    };

    void loadSong();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    audio.src = url;
    audio.loop = true;
    audio.preload = "auto";
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = MUSIC_VOLUME;
    audio.load();

    const syncPlayingState = () => setPlaying(!audio.paused && !audio.ended);
    const onPlay = () => {
      audio.muted = false;
      audio.volume = MUSIC_VOLUME;
      setPlaying(true);
      setError("");
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setError("Skladbu se nepodařilo načíst ze Supabase.");
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    const stateTimer = window.setInterval(syncPlayingState, 250);

    const tryAutoplay = async () => {
      try {
        audio.muted = false;
        audio.volume = MUSIC_VOLUME;
        await audio.play();
        syncPlayingState();
      } catch {
        syncPlayingState();
      }
    };

    void tryAutoplay();

    return () => {
      window.clearInterval(stateTimer);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, [url]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    setError("");

    if (audio.paused) {
      try {
        audio.muted = false;
        audio.volume = MUSIC_VOLUME;
        await audio.play();
        setPlaying(!audio.paused && !audio.ended);
      } catch (playError) {
        console.error("Background music playback failed", playError);
        setPlaying(false);
        setError("Přehrávání bylo prohlížečem zablokováno.");
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  if (!mounted || !hostReady || !hostRef.current) return null;

  return createPortal(
    <>
      <audio ref={audioRef} />
      <button
        type="button"
        data-background-music-button
        onClick={() => void toggle()}
        disabled={!url}
        aria-label={playing ? "Zastavit hudbu" : "Spustit hudbu"}
        title={error || (playing ? "Zastavit hudbu" : "Spustit hudbu")}
        style={{
          position: "fixed",
          right: "16px",
          bottom: "16px",
          zIndex: 2147483647,
          pointerEvents: "auto",
          ...(playing ? {
            animation: "musicBubblePulse 1.8s ease-in-out infinite",
            backgroundColor: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            borderColor: "hsl(var(--primary) / 0.5)",
            boxShadow: "0 0 0 1px hsl(var(--primary) / 0.15), 0 0 24px hsl(var(--primary) / 0.45)",
          } : {}),
        }}
        className="grid h-11 w-11 place-items-center rounded-full border shadow-lg transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {playing ? (
          <>
            <span className="pointer-events-none absolute -inset-1 rounded-full border border-primary/50" style={{ animation: "musicBubbleRing 1.8s ease-out infinite" }} />
            <span className="pointer-events-none absolute -inset-2 rounded-full border border-primary/25" style={{ animation: "musicBubbleRing 1.8s ease-out 0.6s infinite" }} />
            <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/25" style={{ animation: "musicBubbleGlow 1.8s ease-in-out infinite" }} />
          </>
        ) : null}
        <Music2 className="relative z-10 h-5 w-5" />
      </button>
      <style>{`
        @keyframes musicBubblePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes musicBubbleRing {
          0% { opacity: .7; transform: scale(.92); }
          100% { opacity: 0; transform: scale(1.45); }
        }
        @keyframes musicBubbleGlow {
          0%, 100% { opacity: .2; transform: scale(.96); }
          50% { opacity: .5; transform: scale(1.08); }
        }
      `}</style>
    </>,
    hostRef.current,
  );
}
