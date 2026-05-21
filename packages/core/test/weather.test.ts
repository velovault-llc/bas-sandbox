import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetWeatherCache,
  fetchCurrentWeather,
  fetchForecastHourly,
  fetchHistoricalHourly,
  geocodeCity,
  OPEN_METEO_ATTRIBUTION,
  sampleAt,
  type WeatherSeries,
} from '../src/weather.js';

// Mock the global fetch for every test — no real network calls.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  _resetWeatherCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOnceJson(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  })) as typeof fetch;
}

function mockFetchOnceNetworkError(message = 'failed'): void {
  globalThis.fetch = vi.fn(async () => {
    throw new Error(message);
  }) as typeof fetch;
}

describe('attribution', () => {
  it('exports the CC-BY attribution string', () => {
    expect(OPEN_METEO_ATTRIBUTION).toContain('Open-Meteo');
    expect(OPEN_METEO_ATTRIBUTION).toContain('CC-BY');
  });
});

describe('geocodeCity', () => {
  it('returns parsed locations', async () => {
    mockFetchOnceJson({
      results: [
        {
          name: 'Chicago',
          country: 'United States',
          admin1: 'Illinois',
          latitude: 41.85,
          longitude: -87.65,
          timezone: 'America/Chicago',
          population: 2700000,
        },
      ],
    });
    const res = await geocodeCity('Chicago');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(res.value[0].name).toBe('Chicago');
    expect(res.value[0].admin1).toBe('Illinois');
    expect(res.value[0].timezone).toBe('America/Chicago');
  });

  it('returns empty array on empty query (no network call)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await geocodeCity('   ');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('handles no-results gracefully', async () => {
    mockFetchOnceJson({});
    const res = await geocodeCity('Asdfqwer');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it('surfaces Open-Meteo error reason on HTTP failure', async () => {
    mockFetchOnceJson({ reason: 'Cannot initialize' }, 400);
    const res = await geocodeCity('Chicago');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('Cannot initialize');
  });

  it('surfaces network errors', async () => {
    mockFetchOnceNetworkError('ECONNREFUSED');
    const res = await geocodeCity('Chicago');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain('network error');
  });

  it('caches identical queries', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ results: [] }),
    })) as typeof fetch;
    globalThis.fetch = fetchSpy;
    await geocodeCity('Springfield');
    await geocodeCity('Springfield');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('fetchCurrentWeather', () => {
  it('returns a normalized sample in °F / mph', async () => {
    mockFetchOnceJson({
      current: {
        time: '2026-05-20T14:00',
        temperature_2m: 68.4,
        relative_humidity_2m: 55,
        wind_speed_10m: 8.2,
        cloud_cover: 30,
      },
    });
    const res = await fetchCurrentWeather(41.85, -87.65);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual({
      time: '2026-05-20T14:00',
      T_F: 68.4,
      RH: 55,
      windMph: 8.2,
      cloudPct: 30,
    });
  });

  it('fails when current block is missing', async () => {
    mockFetchOnceJson({});
    const res = await fetchCurrentWeather(0, 0);
    expect(res.ok).toBe(false);
  });
});

describe('fetchForecastHourly', () => {
  it('parses an hourly forecast into samples', async () => {
    mockFetchOnceJson({
      latitude: 41.85,
      longitude: -87.65,
      timezone: 'America/Chicago',
      hourly: {
        time: ['2026-05-20T14:00', '2026-05-20T15:00', '2026-05-20T16:00'],
        temperature_2m: [68.4, 70.1, 71.5],
        relative_humidity_2m: [55, 53, 50],
        wind_speed_10m: [8.2, 9.0, 9.5],
        cloud_cover: [30, 25, 20],
      },
    });
    const res = await fetchForecastHourly(41.85, -87.65, { hours: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.location.timezone).toBe('America/Chicago');
    expect(res.value.samples).toHaveLength(3);
    expect(res.value.samples[1].T_F).toBe(70.1);
  });

  it('clamps requested hours to [1, 168]', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ hourly: { time: [], temperature_2m: [] } }),
      };
    }) as typeof fetch;
    await fetchForecastHourly(0, 0, { hours: 999 });
    expect(capturedUrl).toContain('forecast_hours=168');
  });
});

describe('fetchHistoricalHourly', () => {
  it('validates date format', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await fetchHistoricalHourly(0, 0, '2025-08', '2025-08-07');
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('caches identical (lat, lon, range) requests', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        latitude: 33,
        longitude: -112,
        timezone: 'America/Phoenix',
        hourly: {
          time: ['2025-08-01T00:00'],
          temperature_2m: [85],
          relative_humidity_2m: [40],
          wind_speed_10m: [3],
          cloud_cover: [5],
        },
      }),
    })) as typeof fetch;
    globalThis.fetch = fetchSpy;
    await fetchHistoricalHourly(33, -112, '2025-08-01', '2025-08-02');
    await fetchHistoricalHourly(33, -112, '2025-08-01', '2025-08-02');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('sampleAt', () => {
  const series: WeatherSeries = {
    location: { latitude: 0, longitude: 0, timezone: 'UTC' },
    samples: [
      { time: '2026-05-20T12:00Z', T_F: 70, RH: 50, windMph: 5, cloudPct: 0 },
      { time: '2026-05-20T13:00Z', T_F: 80, RH: 40, windMph: 10, cloudPct: 50 },
      { time: '2026-05-20T14:00Z', T_F: 90, RH: 30, windMph: 15, cloudPct: 100 },
    ],
  };

  it('interpolates between bracketing samples', () => {
    const s = sampleAt(series, '2026-05-20T12:30Z');
    expect(s).toBeDefined();
    expect(s!.T_F).toBe(75); // halfway between 70 and 80
    expect(s!.RH).toBe(45);
    expect(s!.windMph).toBe(7.5);
  });

  it('returns first sample when target is before window', () => {
    const s = sampleAt(series, '2026-05-19T00:00Z');
    expect(s?.T_F).toBe(70);
  });

  it('returns last sample when target is after window', () => {
    const s = sampleAt(series, '2026-06-01T00:00Z');
    expect(s?.T_F).toBe(90);
  });

  it('returns undefined for empty series', () => {
    const s = sampleAt(
      { location: { latitude: 0, longitude: 0, timezone: 'UTC' }, samples: [] },
      '2026-05-20T12:30Z',
    );
    expect(s).toBeUndefined();
  });
});
