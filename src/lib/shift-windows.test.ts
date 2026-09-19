import { describe, expect, it } from "vitest";
import { NET_PRODUCTIVE_MINUTES, remainingProductiveMinutes } from "./shift-windows";

// Parita s kanonickou SQL funkcí public.auto_shift_productive_minutes() (ověřeno přímo v DB):
// Ranní 06:00-14:00/pauza 10:40-11:10, Odpolední 14:00-22:00/pauza 18:00-18:30,
// Noční 22:00-06:00/pauza 02:00-02:30, čistý čas = 8h - 30min pauza - 7min příprava - 5min úklid = 438 min.
describe("remainingProductiveMinutes", () => {
  it("matches the documented 438 net minutes when measured from the very start of each shift", () => {
    expect(remainingProductiveMinutes("Ranní", "06:00")).toBe(NET_PRODUCTIVE_MINUTES);
    expect(remainingProductiveMinutes("Odpolední", "14:00")).toBe(NET_PRODUCTIVE_MINUTES);
    expect(remainingProductiveMinutes("Noční", "22:00")).toBe(NET_PRODUCTIVE_MINUTES);
    expect(NET_PRODUCTIVE_MINUTES).toBe(438);
  });

  it("excludes the break window when measured from before it", () => {
    // Od 10:00 do konce Ranní: zbývá 240 min do pauzy (10:00-10:40) + zbytek po pauze (11:10-13:55=165) = 405
    expect(remainingProductiveMinutes("Ranní", "10:00")).toBe(40 + 165);
  });

  it("is unaffected by the break once already past it", () => {
    // Od 12:00 (po pauze) do 13:55 (konec směny minus 5 min úklid) = 115 min, bez odečtu pauzy
    expect(remainingProductiveMinutes("Ranní", "12:00")).toBe(115);
  });

  it("returns 0 once the shift's productive window is over", () => {
    expect(remainingProductiveMinutes("Ranní", "13:56")).toBe(0);
  });

  it("handles the Noční midnight rollover correctly", () => {
    // 23:00 je v noční směně "1380" absolutních minut (22:00=1320); do konce zbývá stejně jako u Ranní od 07:00.
    expect(remainingProductiveMinutes("Noční", "23:00")).toBe(remainingProductiveMinutes("Ranní", "07:00"));
    // Čas PŘED 22:00 (např. 01:00) patří k noční směně, která začala předchozí den.
    expect(remainingProductiveMinutes("Noční", "01:00")).toBeGreaterThan(0);
    expect(remainingProductiveMinutes("Noční", "01:00")).toBeLessThan(NET_PRODUCTIVE_MINUTES);
  });
});
