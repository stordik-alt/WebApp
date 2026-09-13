import { useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, Volume2, VolumeX, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

const VOLUME_KEY = "app-background-music-volume";
const BUCKET = "background-music";
const PATH = "walk.mp3";

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.25);
  const { role } = useAuth();
  const isAdmin = role === "admin";

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) setVolume(stored);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(PATH);
    setUrl(data.publicUrl);
  }, []);

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
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.pause();
    };
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    if (audio.paused) {
      try { await audio.play(); } catch { /* autoplay requires user gesture */ }
    } else audio.pause();
  };

  const uploadSong = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("audio/") || !isAdmin) return;
    const { error } = await supabase.storage.from(BUCKET).upload(PATH, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: "0",
    });
    if (error) return;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(PATH);
    setUrl(`${data.publicUrl}?v=${Date.now()}`);
    setPlaying(false);
  };

  const changeVolume = (next: number) => {
    const safe = Math.min(1, Math.max(0, next));
    setVolume(safe);
    setMuted(false);
    window.localStorage.setItem(VOLUME_KEY, String(safe));
  };

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-1 rounded-2xl border border-border/80 bg-card/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl">
      <audio ref={audioRef} />
      <Music2 className="ml-1.5 h-4 w-4 text-primary" />
      {isAdmin ? (
        <>
          <label className="sr-only" htmlFor="background-music-file">Nahrát globální skladbu</label>
          <input id="background-music-file" type="file" accept="audio/*" className="hidden" onChange={(e) => void uploadSong(e.target.files?.[0])} />
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => document.getElementById("background-music-file")?.click()} aria-label="Nahrát globální skladbu">
            <Upload className="h-4 w-4" />
          </Button>
        </>
      ) : null}
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => void toggle()} disabled={!url} aria-label={playing ? "Pozastavit hudbu" : "Spustit hudbu"}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl" onClick={() => setMuted((value) => !value)} disabled={!url} aria-label={muted ? "Zapnout zvuk" : "Ztlumit hudbu"}>
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>
      <input aria-label="Hlasitost hudby" type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} className="hidden w-20 sm:block" />
    </div>
  );
}
