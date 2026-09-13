import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "app-background-music-url";
const ENABLED_KEY = "app-background-music-enabled";
const VOLUME_KEY = "app-background-music-volume";

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME_KEY) ?? "0.25"));

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    audio.src = url;
    audio.loop = true;
    audio.volume = muted ? 0 : volume;
    audio.preload = "auto";
  }, [url, volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    return () => {
      audio.pause();
    };
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      try {
        await audio.play();
        localStorage.setItem(ENABLED_KEY, "true");
      } catch {
        // Browser autoplay policy: playback must be started by a user gesture.
      }
    } else {
      audio.pause();
      localStorage.setItem(ENABLED_KEY, "false");
    }
  };

  const chooseFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("audio/")) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    localStorage.setItem(STORAGE_KEY, objectUrl);
  };

  const changeVolume = (next: number) => {
    const safe = Math.min(1, Math.max(0, next));
    setVolume(safe);
    localStorage.setItem(VOLUME_KEY, String(safe));
    setMuted(false);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-2xl border border-border/80 bg-card/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl">
      <audio ref={audioRef} />
      <Music2 className="ml-1.5 h-4 w-4 text-primary" />
      <label className="sr-only" htmlFor="background-music-file">Vybrat hudbu</label>
      <input
        id="background-music-file"
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => chooseFile(e.target.files?.[0])}
      />
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => document.getElementById("background-music-file")?.click()} aria-label="Vybrat skladbu">
        <Music2 className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => void toggle()} disabled={!url} aria-label={playing ? "Pozastavit hudbu" : "Spustit hudbu"}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => setMuted((value) => !value)} disabled={!url} aria-label={muted ? "Zapnout zvuk" : "Ztlumit hudbu"}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>
      <input
        aria-label="Hlasitost hudby"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={muted ? 0 : volume}
        onChange={(e) => changeVolume(Number(e.target.value))}
        className="hidden w-20 sm:block"
      />
    </div>
  );
}
