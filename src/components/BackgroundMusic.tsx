import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

const VOLUME_KEY = "app-background-music-volume";
const BUCKET = "background-music";
const PREFERRED_PATH = "walk.mp3";

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.25);
  const [error, setError] = useState("");
  const { role } = useAuth();
  const isAdmin = role === "admin";

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) setVolume(stored);

    let cancelled = false;
    const loadSong = async () => {
      const { data: files, error: listError } = await supabase.storage.from(BUCKET).list("", {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });

      if (cancelled) return;
      if (listError) {
        setError("Hudbu se nepodařilo načíst.");
        return;
      }

      const audioFiles = (files ?? []).filter((file) => /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name));
      const file = audioFiles.find((item) => item.name.toLowerCase() === PREFERRED_PATH) ?? audioFiles[0];
      if (!file) {
        setError("V úložišti není nalezena žádná skladba.");
        return;
      }

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(file.name);
      setUrl(data.publicUrl);
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
    audio.volume = volume;
    audio.load();
  }, [url, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setError("Skladbu se nepodařilo přehrát.");
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
        await audio.play();
      } catch {
        setError("Přehrávání zablokoval prohlížeč.");
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
