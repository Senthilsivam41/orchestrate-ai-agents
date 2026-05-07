import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const REPO_ROOT = path.resolve(process.cwd(), "..");
const VENV_PYTHON = path.join(REPO_ROOT, "venv", "bin", "python3");

// ── Nominatim geocoding ───────────────────────────────────────────────────────
async function geocode(place: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "TripMind/1.0 trip-planner" } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": "TripMind/1.0 trip-planner" } });
  const d = await res.json();
  return d.address?.village || d.address?.town || d.address?.city || d.address?.county || "en route";
}

// ── Polyline decoder (Google format used by OSRM) ────────────────────────────
function decodePolyline(encoded: string): [number, number][] {
  const pts: [number, number][] = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

function haversine([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── OSRM route ────────────────────────────────────────────────────────────────
async function getOSRMRoute(o: { lat: number; lon: number }, d: { lat: number; lon: number }) {
  const url = `http://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=full&steps=true`;
  const res = await fetch(url, { headers: { "User-Agent": "TripMind/1.0" } });
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("OSRM failed");
  return data.routes[0];
}

function addMinutes(base: string, mins: number): string {
  const [time, ampm] = base.split(" ");
  const [h, m] = time.split(":").map(Number);
  let total = (ampm === "PM" && h !== 12 ? h + 12 : h) * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24, nm = total % 60;
  const na = nh >= 12 ? "PM" : "AM", dh = nh > 12 ? nh - 12 : nh === 0 ? 12 : nh;
  return `${dh.toString().padStart(2, "0")}:${nm.toString().padStart(2, "0")} ${na}`;
}

// ── Open-Meteo weather ────────────────────────────────────────────────────────
const WMO: Record<number, { emoji: string; label: string }> = {
  0: { emoji: "☀️", label: "Clear sky" }, 1: { emoji: "🌤️", label: "Mainly clear" },
  2: { emoji: "⛅", label: "Partly cloudy" }, 3: { emoji: "☁️", label: "Overcast" },
  45: { emoji: "🌫️", label: "Foggy" }, 48: { emoji: "🌫️", label: "Icy fog" },
  51: { emoji: "🌦️", label: "Light drizzle" }, 53: { emoji: "🌦️", label: "Drizzle" },
  61: { emoji: "🌧️", label: "Light rain" }, 63: { emoji: "🌧️", label: "Rain" },
  65: { emoji: "🌧️", label: "Heavy rain" }, 71: { emoji: "❄️", label: "Light snow" },
  80: { emoji: "🌦️", label: "Showers" }, 81: { emoji: "🌧️", label: "Heavy showers" },
  95: { emoji: "⛈️", label: "Thunderstorm" },
};
function wmo(code: number) { return WMO[code] ?? { emoji: "🌡️", label: "Variable" }; }

async function fetchWeather(lat: number, lon: number, days: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,windspeed_10m_max` +
    `&timezone=auto&forecast_days=${Math.min(days + 1, 7)}`;
  const res = await fetch(url);
  const data = await res.json();
  const d = data.daily;
  return (d.time as string[]).slice(0, days + 1).map((date: string, i: number) => ({
    date,
    ...wmo(d.weathercode[i]),
    temp_max: Math.round(d.temperature_2m_max[i]),
    temp_min: Math.round(d.temperature_2m_min[i]),
    precipitation_mm: Math.round(d.precipitation_sum[i] * 10) / 10,
    wind_kmh: Math.round(d.windspeed_10m_max[i]),
  }));
}

// ── Python runner ─────────────────────────────────────────────────────────────
async function runTripPlanner(dest: string, orig: string, numDays: number, numPeople: number, prefs: unknown) {
  const script = `
import sys, json
sys.path.insert(0, "${REPO_ROOT}")
from trip_planner import build_graph, TripState
state: TripState = {
  "destination": "${dest}", "origin": "${orig}",
  "num_days": ${numDays}, "num_people": ${numPeople},
  "preferences": ${JSON.stringify(prefs)},
  "route_plan": {}, "restaurants": [], "homestays": [],
  "attractions": [], "itinerary": {}, "execution_log": [], "status": "pending"
}
final = build_graph().invoke(state)
print(json.dumps({"itinerary": final.get("itinerary",{}), "execution_log": final.get("execution_log",[]), "status": final.get("status","")}, ensure_ascii=False))
`.trim();

  const { stdout } = await execAsync(
    `${VENV_PYTHON} -c '${script.replace(/'/g, "'\"'\"'")}'`,
    { timeout: 30000 }
  );
  const jsonLine = stdout.trim().split("\n").find(l => l.trim().startsWith("{"));
  if (!jsonLine) throw new Error("No JSON from planner");
  return JSON.parse(jsonLine);
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dest = body.destination || "Coorg, Karnataka";
    const orig = body.origin || "Bengaluru";
    const numDays = body.num_days || 3;
    const numPeople = body.num_people || 4;
    const prefs = body.preferences || { accommodation_type: "homestay", food_preference: "vegetarian-friendly", activity_level: "moderate", budget_per_day: 9000 };

    // 1. Geocode in parallel
    const [origCoords, destCoords] = await Promise.all([geocode(orig), geocode(dest)]);

    let realRoute = null;
    let weather = null;

    // 2. Real route (OSRM + Nominatim)
    if (origCoords && destCoords) {
      try {
        const r = await getOSRMRoute(origCoords, destCoords);
        const distKm = Math.round(r.distance / 1000);
        const durHrs = Math.round((r.duration / 3600) * 10) / 10;

        // Top road name from steps
        const freq: Record<string, number> = {};
        for (const s of r.legs?.[0]?.steps || []) {
          if (s.name) freq[s.name] = (freq[s.name] || 0) + 1;
        }
        const highway = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || "Main Highway";

        // Intermediate stop coords from polyline
        const coords = decodePolyline(r.geometry);
        const cumDist: number[] = [0];
        for (let i = 1; i < coords.length; i++) cumDist.push(cumDist[i - 1] + haversine(coords[i - 1], coords[i]));
        const total = cumDist[cumDist.length - 1];

        const coordAt = (frac: number) => {
          const target = total * frac;
          let best = 0;
          for (let i = 0; i < cumDist.length; i++) if (Math.abs(cumDist[i] - target) < Math.abs(cumDist[best] - target)) best = i;
          return coords[best];
        };

        // Sequential to respect Nominatim rate limit
        const s1 = coordAt(0.33);
        const stop1Name = await reverseGeocode(s1[0], s1[1]);
        await new Promise(r => setTimeout(r, 200));
        const s2 = coordAt(0.66);
        const stop2Name = await reverseGeocode(s2[0], s2[1]);

        const dep = "06:30 AM";
        const durMins = Math.round(durHrs * 60);

        realRoute = {
          origin: orig, destination: dest,
          total_distance_km: distKm,
          estimated_drive_hours: durHrs,
          departure_time: dep,
          arrival_time: `${addMinutes(dep, durMins)} (Day 1)`,
          highway,
          source: "OSRM + OpenStreetMap",
          fuel_stops: [
            `Km ${Math.round(distKm * 0.33)} – Fuel stop near ${stop1Name}`,
            `Km ${Math.round(distKm * 0.66)} – Fuel stop near ${stop2Name}`,
          ],
          rest_stops: [
            { name: `Rest area near ${stop1Name}`, km_mark: Math.round(distKm * 0.33), suggested_break: `${addMinutes(dep, Math.round(durMins * 0.33) - 15)} – ${addMinutes(dep, Math.round(durMins * 0.33) + 15)}`, type: "Breakfast / stretch stop" },
            { name: `Rest area near ${stop2Name}`, km_mark: Math.round(distKm * 0.66), suggested_break: `${addMinutes(dep, Math.round(durMins * 0.66) - 15)} – ${addMinutes(dep, Math.round(durMins * 0.66) + 15)}`, type: "Coffee / stretch break" },
          ],
        };
      } catch (e) {
        console.error("Route fetch failed:", e);
      }
    }

    // 3. Weather (Open-Meteo — free, no key)
    if (destCoords) {
      try {
        const days = await fetchWeather(destCoords.lat, destCoords.lon, numDays);
        weather = { location: dest, days, source: "Open-Meteo" };
      } catch (e) {
        console.error("Weather fetch failed:", e);
      }
    }

    // 4. Run Python LangGraph
    const result = await runTripPlanner(dest, orig, numDays, numPeople, prefs);

    // 5. Inject real data into itinerary
    if (realRoute && result.itinerary) result.itinerary.travel_route = realRoute;
    if (weather && result.itinerary) result.itinerary.weather = weather;

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("API error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
