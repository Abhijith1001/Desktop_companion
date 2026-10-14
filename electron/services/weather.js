// Local weather for the buddy, from Open-Meteo (free, no API key). Only the
// location the user picked is sent; nothing else leaves the computer.
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OSM_URL = 'https://nominatim.openstreetmap.org/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const IP_SERVICES = [
  { url: 'https://ipwho.is/', country: 'country' },
  { url: 'https://ipapi.co/json/', country: 'country_name' },
  { url: 'https://get.geojs.io/v1/ip/geo.json', country: 'country' },
];
const REFRESH_MS = 15 * 60_000;
// Forecast models report light drizzle far more often than it actually
// falls, so below this much rain in the current 15 minutes it's just cloudy.
const MIN_RAIN_MM = 0.5;
const TIMEOUT_MS = 10_000;

// WMO weather codes → the handful of looks the buddy can show.
function kindOf(code, precipitation) {
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  if (wet && precipitation != null && precipitation < MIN_RAIN_MM) return 'cloudy';
  if (code >= 51 && code <= 57 && precipitation == null) return 'cloudy'; // drizzle
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

const DESCRIBE = { clear: 'clear', cloudy: 'cloudy', fog: 'foggy', rain: 'rainy', snow: 'snowing', storm: 'stormy' };
const EMOJI = { clear: '☀️', cloudy: '☁️', fog: '🌫️', rain: '🌧️', snow: '❄️', storm: '⛈️' };

function createWeather({ settings, log, onUpdate = () => {}, fetchImpl = fetch }) {
  let current = null;
  let timer = null;

  async function getJson(url) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
    return res.json();
  }

  async function search(query) {
    const q = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' });
    const data = await getJson(`${GEO_URL}?${q}`);
    const found = (data.results || []).map((r) => ({
      name: r.name, lat: r.latitude, lon: r.longitude,
      country: [r.admin1, r.country].filter(Boolean).join(', ').slice(0, 80),
    }));
    if (found.length) return found;
    // Open-Meteo only knows larger places; OpenStreetMap also has villages.
    try {
      const n = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', addressdetails: '1', 'accept-language': 'en' });
      const res = await fetchImpl(`${OSM_URL}?${n}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'DesktopBuddy/2 (weather lookup)' },
      });
      if (!res.ok) return [];
      return (await res.json()).map((r) => {
        const a = r.address || {};
        return {
          name: r.name || a.village || a.town || a.city || query, lat: Number(r.lat), lon: Number(r.lon),
          country: [a.state, a.country].filter(Boolean).join(', ').slice(0, 80),
        };
      }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    } catch (err) {
      log.warn('osm search failed', { error: err.message });
      return [];
    }
  }

  // Approximate location from the public IP address (city level). Free
  // services rate-limit, so try a few in turn.
  async function locate() {
    for (const { url, country } of IP_SERVICES) {
      try {
        const d = await getJson(url);
        const lat = Number(d.latitude);
        const lon = Number(d.longitude);
        if (d.success === false || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        return { name: d.city || 'My location', lat, lon, country: [d.region, d[country]].filter(Boolean).join(', ').slice(0, 80) };
      } catch (err) {
        log.warn('ip location lookup failed', { url, error: err.message });
      }
    }
    throw new Error('Could not work out your location — search for your city instead');
  }

  async function refresh() {
    const w = settings.get('weather');
    if (!w.enabled || !w.location) {
      if (current) { current = null; onUpdate(null); }
      return null;
    }
    try {
      const q = new URLSearchParams({
        latitude: String(w.location.lat), longitude: String(w.location.lon),
        current: 'temperature_2m,weather_code,is_day,precipitation', temperature_unit: w.unit === 'F' ? 'fahrenheit' : 'celsius',
      });
      const c = (await getJson(`${FORECAST_URL}?${q}`)).current;
      const kind = kindOf(c.weather_code, typeof c.precipitation === 'number' ? c.precipitation : null);
      current = {
        kind, day: c.is_day === 1, temp: Math.round(c.temperature_2m), unit: w.unit === 'F' ? 'F' : 'C',
        description: DESCRIBE[kind], emoji: EMOJI[kind], place: w.location.name, at: new Date().toISOString(),
      };
      onUpdate(current);
    } catch (err) {
      log.warn('weather refresh failed', { error: err.message });
    }
    return current;
  }

  return {
    search, locate, refresh,
    current: () => current,
    start() { refresh(); timer = setInterval(refresh, REFRESH_MS); },
    stop() { clearInterval(timer); },
  };
}

module.exports = { createWeather, kindOf };
