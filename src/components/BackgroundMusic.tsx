import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "background-music";
const PREFERRED_PATH = "walk.mp3";
const MUSIC_VOLUME = 0.35;

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadSong = async () => {
      // walk.mp3 is the canonical file. Do not depend on bucket listing permissions.
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(PREFERRED_PATH).data.publicUrl;
      if (!cancelled) setUrl(publicUrl);

      // Fallback if the canonical file is not present.
      const { data: files } = await supabase.storage.from(BUCKET).list("", {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });
      if (cancelled) return;

      const audioFiles = (files ?? []).filter((file) => /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name));
      const file = audioFiles.find((item) => item.name.toLowerCase() === PREFERRED_PATH) ?? audioFiles[0];
      if (file) {
        setUrl(supabase.storage.from(BUCKET).getPublicUrl(file.name).data.publicUrl);
      }
      setError("");
    };

    void loadSong();
    return () => {
      cancelled = true;
    };
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
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      audio.muted = false;
      audio.volume = MUSIC_VOLUME;
      setPlaying(true);
      setError("");
    };
    const onPause = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setError("Skladbu se nepodařilo načíst ze Supabase.");
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !url) return;

    setError("");
    if (audio.paused) {
      try {
        audio.muted = false;
        audio.volume = MUSIC_VOLUME;
        await audio.play();
      } catch (playError) {
        console.error("Background music playback failed", playError);
        setPlaying(false);
        setError("Přehrávání bylo prohlížečem zablokováno.");
      }
    } else {
      audio.pause();
    }
  };

  return (
    <>
      <audio ref={audioRef} />
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={!url}
        aria-label={playing ? "Zastavit hudbu" : "Spustit hudbu"}
        title={error || (playing ? "Zastavit hudbu" : "Spustit hudbu")}
        className={`fixed bottom-4 right-4 z-[60] grid h-11 w-11 place-items-center rounded-full border shadow-lg transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-60 ${
          playing
            ? "border-primary/40 bg-primary text-primary-foreground shadow-primary/30"
            : "border-border bg-muted text-muted-foreground shadow-black/10"
        }`}
      >
        {playing ? (
          <>
            <span className="pointer-events-none absolute inset-0 rounded-full border border-primary/60 animate-ping" />
            <span className="pointer-events-none absolute -inset-1.5 rounded-full border border-primary/30 animate-[pulse_1.8s_ease-in-out_infinite]" />
          </>
        ) : null}
        <Music2 className="relative z-10 h-5 w-5" />
      </button>
    </>
  );
}
