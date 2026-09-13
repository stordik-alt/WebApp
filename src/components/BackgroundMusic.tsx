import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";
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

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) setVolume(stored);

    let cancelled = false;
    const loadSong = async () => {
      // Nečekáme na storage.list(): přehrávač musí být schopný použít pevnou
      // cestu i v případě, že listování bucketu není pro veřejného uživatele povoleno.
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(PREFERRED_PATH);
      if (!cancelled) setUrl(data.publicUrl);

      // Pokud walk.mp3 neexistuje, zkusíme najít první audio soubor v bucketu.
      const { data: files } = await supabase.storage.from(BUCKET).list("", {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });
      if (cancelled) return;

      const audioFiles = (files ?? []).filter((file) => /\.(mp3|wav|ogg|m4a|aac|webm)$/i.test(file.name));
      if (audioFiles.length === 0) return;

      const file = audioFiles.find((item) => item.name.toLowerCase() === PREFERRED_PATH) ?? audioFiles[0];
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(file.name).data.publicUrl;
      setUrl(publicUrl);
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
  }, [url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
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
        await audio.play();
      } catch (playError) {
        console.error("Background music playback failed", playError);
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
