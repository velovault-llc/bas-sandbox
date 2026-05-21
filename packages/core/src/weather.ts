// Typed Open-Meteo client.
//
// Open-Meteo (open-meteo.com) is a free, no-API-key weather service with
// CORS enabled — calls work straight from the browser, no proxy needed.
//
// We use it for three modes in bas-sandbox's weather feature:
//   - Live: fetchCurrentWeather + fetchForecastHourly for "what's it doing
//     right now / next 24 h at this location?"
//   - Historical: fetchHistoricalHourly for "replay a real day from the
//     ERA5 archive" (1940 — present, ~5-day lag).
//   - Geocoding: turn a city name into lat/lon for the other endpoints.
//
// License posture: Open-Meteo serves under CC-BY 4.0 — attribution string
// exported below; the UI shows it wherever weather data renders.
//
// All temperatures returned in °F, wind speeds in mph (we ask for those
// units at the URL level so the consumer doesn't deal with conversion).

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search';

export const OPEN_METEO_ATTRIBUTION =
  'Weather data by Open-Meteo (open-meteo.com), CC-BY 4.0';

export interface GeocodedLocation {
  /** City / place name as Open-Meteo returns it. */
  readonly name: string;
  /** ISO country name (e.g. "United States"). */
  readonly country: string;
  /** First administrative subdivision — state, province, region. May be absent. */
  readonly admin1?: string;
  readonly latitude: number;
  readonly longitude: number;
  /** IANA timezone, e.g. "America/Chicago". */
  readonly timezone: string;
  /** Population if Open-Meteo has it — useful for disambiguating "Springfield". */
  readonly population?: number;
}

export interface WeatherSample {
  /** ISO-8601 timestamp from Open-Meteo, local to the queried location's timezone. */
  readonly time: string;
  /** Outside air temperature, °F. */
  readonly T_F: number;
  /** Relative humidity, %. */
  readonly RH: number;
  /** Wind speed at 10 m, mph. */
  readonly windMph: number;
  /** Cloud cover, %. */
  readonly cloudPct: number;
}

export interface WeatherSeries {
  readonly location: {
    readonly latitude: number;
    readonly longitude: number;
    readonly timezone: string;
  };
  readonly samples: readonly WeatherSample[];
}

/**
 * Result wrapper — callers get a discriminated union instead of try/catch.
 * Network failures, malformed responses, and Open-Meteo error payloads all
 * funnel into `{ ok: false, error }` with a human-readable string.
 */
export type WeatherResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Per-session cache for the two endpoints whose responses are immutable:
//   - Geocoding (city name -> lat/lon is stable for the session).
//   - Historical archive (a finished date's hourly data won't change).
// Current/forecast endpoints are NOT cached — callers expect fresh data.
const cache = new Map<string, unknown>();

interface HourlyApiResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    wind_speed_10m?: number[];
    cloud_cover?: number[];
  };
  latitude?: number;
  longitude?: number;
  timezone?: string;
  reason?: string;
}

interface CurrentApiResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    cloud_cover?: number;
  };
  reason?: string;
}

interface GeocodeApiResponse {
  results?: Array<{
    name?: string;
    country?: string;
    admin1?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
    population?: number;
  }>;
  reason?: string;
}

/**
 * Look up a city by name. Returns up to `count` candidates ordered by
 * Open-Meteo's relevance ranking. Empty result is `{ ok: true, value: [] }`,
 * not an error.
 */
export async function geocodeCity(
  query: string,
  opts: { count?: number; signal?: AbortSignal } = {},
): Promise<WeatherResult<readonly GeocodedLocation[]>> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, value: [] };
  const count = opts.count ?? 5;
  const url = `${GEOCODE_BASE}?name=${encodeURIComponent(trimmed)}&count=${count}&language=en&format=json`;
  if (cache.has(url)) return { ok: true, value: cache.get(url) as GeocodedLocation[] };

  const res = await fetchJson<GeocodeApiResponse>(url, opts.signal);
  if (!res.ok) return res;
  const value: GeocodedLocation[] = (res.value.results ?? [])
    .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
    .map((r) => ({
      name: r.name ?? trimmed,
      country: r.country ?? '',
      admin1: r.admin1,
      latitude: r.latitude as number,
      longitude: r.longitude as number,
      timezone: r.timezone ?? 'UTC',
      population: r.population,
    }));
  cache.set(url, value);
  return { ok: true, value };
}

/**
 * Current conditions at the given location. Single sample, marked with the
 * server's "now" timestamp (rounded to the nearest 15 min).
 */
export async function fetchCurrentWeather(
  latitude: number,
  longitude: number,
  opts: { signal?: AbortSignal } = {},
): Promise<WeatherResult<WeatherSample>> {
  const url = buildUrl(FORECAST_BASE, {
    latitude,
    longitude,
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  });
  const res = await fetchJson<CurrentApiResponse>(url, opts.signal);
  if (!res.ok) return res;
  const c = res.value.current;
  if (
    !c ||
    typeof c.time !== 'string' ||
    typeof c.temperature_2m !== 'number'
  ) {
    return { ok: false, error: 'Open-Meteo returned no current observation' };
  }
  return {
    ok: true,
    value: {
      time: c.time,
      T_F: c.temperature_2m,
      RH: c.relative_humidity_2m ?? 0,
      windMph: c.wind_speed_10m ?? 0,
      cloudPct: c.cloud_cover ?? 0,
    },
  };
}

/**
 * Hourly forecast starting at the current hour. `hours` clamps how many
 * samples to keep (Open-Meteo returns 7 days = 168 hours by default).
 */
export async function fetchForecastHourly(
  latitude: number,
  longitude: number,
  opts: { hours?: number; signal?: AbortSignal } = {},
): Promise<WeatherResult<WeatherSeries>> {
  const hours = Math.max(1, Math.min(opts.hours ?? 48, 168));
  const url = buildUrl(FORECAST_BASE, {
    latitude,
    longitude,
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover',
    forecast_hours: hours,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  });
  const res = await fetchJson<HourlyApiResponse>(url, opts.signal);
  if (!res.ok) return res;
  return hourlyToSeries(res.value);
}

/**
 * Hourly historical archive (ERA5 reanalysis). Dates are 'YYYY-MM-DD' in the
 * location's local time. End date inclusive. Data lags ~5 days behind real
 * time — for "today" or "yesterday" use the forecast endpoint instead, it
 * back-fills with measured data once observations land.
 */
export async function fetchHistoricalHourly(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  opts: { signal?: AbortSignal } = {},
): Promise<WeatherResult<WeatherSeries>> {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return { ok: false, error: 'startDate / endDate must be YYYY-MM-DD' };
  }
  const url = buildUrl(ARCHIVE_BASE, {
    latitude,
    longitude,
    start_date: startDate,
    end_date: endDate,
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
  });
  if (cache.has(url)) return { ok: true, value: cache.get(url) as WeatherSeries };
  const res = await fetchJson<HourlyApiResponse>(url, opts.signal);
  if (!res.ok) return res;
  const series = hourlyToSeries(res.value);
  if (series.ok) cache.set(url, series.value);
  return series;
}

/**
 * Linear-interpolate within an hourly series at a target ISO timestamp.
 * Returns the bracketing-pair interpolation, or the nearest sample if the
 * target is outside the series window. Returns `undefined` for an empty series.
 */
export function sampleAt(
  series: WeatherSeries,
  targetIso: string,
): WeatherSample | undefined {
  if (series.samples.length === 0) return undefined;
  const target = Date.parse(targetIso);
  if (!Number.isFinite(target)) return series.samples[0];
  let lo = 0;
  let hi = series.samples.length - 1;
  const tFirst = Date.parse(series.samples[lo].time);
  const tLast = Date.parse(series.samples[hi].time);
  if (target <= tFirst) return series.samples[lo];
  if (target >= tLast) return series.samples[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const tMid = Date.parse(series.samples[mid].time);
    if (tMid <= target) lo = mid;
    else hi = mid;
  }
  const a = series.samples[lo];
  const b = series.samples[hi];
  const tA = Date.parse(a.time);
  const tB = Date.parse(b.time);
  const f = tB === tA ? 0 : (target - tA) / (tB - tA);
  return {
    time: targetIso,
    T_F: lerp(a.T_F, b.T_F, f),
    RH: lerp(a.RH, b.RH, f),
    windMph: lerp(a.windMph, b.windMph, f),
    cloudPct: lerp(a.cloudPct, b.cloudPct, f),
  };
}

/** Cache reset — exposed for tests; production paths don't call it. */
export function _resetWeatherCache(): void {
  cache.clear();
}

// ─── internal helpers ───

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, f));
}

function buildUrl(base: string, params: Record<string, string | number>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function fetchJson<T>(
  url: string,
  signal: AbortSignal | undefined,
): Promise<WeatherResult<T>> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      // Open-Meteo error responses are JSON with { reason: "..." } — surface
      // that rather than just the HTTP status when present.
      let reason = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { reason?: string };
        if (body?.reason) reason = body.reason;
      } catch {
        // not JSON; keep the status string
      }
      return { ok: false, error: `Open-Meteo: ${reason}` };
    }
    const value = (await res.json()) as T;
    return { ok: true, value };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'aborted' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `network error: ${msg}` };
  }
}

function hourlyToSeries(raw: HourlyApiResponse): WeatherResult<WeatherSeries> {
  const h = raw.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m)) {
    return { ok: false, error: 'Open-Meteo returned no hourly data' };
  }
  const n = h.time.length;
  const samples: WeatherSample[] = [];
  for (let i = 0; i < n; i++) {
    const T = h.temperature_2m?.[i];
    if (typeof T !== 'number') continue;
    samples.push({
      time: h.time[i],
      T_F: T,
      RH: h.relative_humidity_2m?.[i] ?? 0,
      windMph: h.wind_speed_10m?.[i] ?? 0,
      cloudPct: h.cloud_cover?.[i] ?? 0,
    });
  }
  return {
    ok: true,
    value: {
      location: {
        latitude: raw.latitude ?? 0,
        longitude: raw.longitude ?? 0,
        timezone: raw.timezone ?? 'UTC',
      },
      samples,
    },
  };
}
