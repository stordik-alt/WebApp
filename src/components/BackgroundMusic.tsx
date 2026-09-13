import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "background-music";
const PREFERRED_PATH = "walk.mp3";
const MUSIC_VOLUME = 0.35;

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);

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

    const syncPlayingState = () => {
      setPlaying(!audio.paused && !audio.ended);
    };

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

    const resumeAfterInteraction = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-background-music-button]")) return;
      if (!audio.paused) return;
      void audio.play().then(syncPlayingState).catch(() => undefined);
    };

    void tryAutoplay();
    window.addEventListener("pointerdown", resumeAfterInteraction, { passive: true });
    window.addEventListener("keydown", resumeAfterInteraction, { passive: true });

    return () => {
      window.clearInterval(stateTimer);
      window.removeEventListener("pointerdown", resumeAfterInteraction);
      window.removeEventListener("keydown", resumeAfterInteraction);
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

  if (!mounted) return null;

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
        style={playing ? {
          animation: "musicBubblePulse 1.8s cubic-bezier(.4,0,.2,1) infinite",
          backgroundColor: "hsl(var(--primary))",
          color: "hsl(var(--primary-foreground))",
          borderColor: "hsl(var(--primary) / 0.5)",
          boxShadow: "0 0 0 1px hsl(var(--primary) / 0.15), 0 0 24px hsl(var(--primary) / 0.45)",
        } : undefined}
        className="fixed bottom-4 right-4 z-[9999] grid h-11 w-11 place-items-center rounded-full border shadow-lg transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {playing ? (
          <>
            <span className="pointer-events-none absolute -inset-1 rounded-full border border-primary/50" style={{ animation: "musicBubbleRing 1.8s ease-out infinite" }} />
            <span className="pointer-events-none absolute -inset-2.5 rounded-full border border-primary/25" style={{ animation: "musicBubbleRing 1.8s ease-out .6s infinite" }} />
            <span className="pointer-events-none absolute -inset-4 rounded-full border border-primary/10" style={{ animation: "musicBubbleRing 2.4s ease-out 1.2s infinite" }} />
            <span className="pointer-events-none absolute inset-0 rounded-full bg-primary/25" style={{ animation: "musicBubbleGlow 1.8s ease-in-out infinite" }} />
            <span className="pointer-events-none absolute inset-[-7px]" style={{ animation: "musicBubbleOrbit 3s linear infinite" }}>
              <span className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            </span>
            <span className="pointer-events-none absolute inset-[-7px]" style={{ animation: "musicBubbleOrbit 3s linear infinite reverse" }}>
              <span className="absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary/80" />
            </span>
          </>
        ) : null}
        <Music2
          className="relative z-10 h-5 w-5"
          style={playing ? { animation: "musicNoteBounce 1.8s ease-in-out infinite" } : undefined}
        />
      </button>
      <style>{`
        @keyframes musicBubblePulse {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.04); }
          50% { transform: scale(1.09); }
          75% { transform: scale(1.03); }
        }
        @keyframes musicBubbleRing {
          0% { opacity: .72; transform: scale(.88); }
          70% { opacity: .18; }
          100% { opacity: 0; transform: scale(1.55); }
        }
        @keyframes musicBubbleGlow {
          0%, 100% { opacity: .18; transform: scale(.94); }
          35% { opacity: .48; transform: scale(1.03); }
          65% { opacity: .3; transform: scale(1.1); }
        }
        @keyframes musicBubbleOrbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes musicNoteBounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-1px) rotate(-4deg); }
          50% { transform: translateY(1px) rotate(3deg); }
          75% { transform: translateY(-1px) rotate(-2deg); }
        }
      `}</style>
    </>,
    document.body,
  );
}
