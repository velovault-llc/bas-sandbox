// Weather-drive store for the sandbox simulator.
//
// Holds the chosen weather source (live forecast / historical archive /
// curated preset), the loaded hourly series, and a playback clock that
// BuildCanvas ticks each sim-frame. The current interpolated sample is
// computed on demand and fed into every SingleZoneSystem as outdoorAir.
//
// Modes:
//   off        — no weather drive; the sim uses each system's static
//                config.outdoorAir (existing behavior).
//   live       — current + 48 h forecast for the chosen location. Playback
//                starts at the server's current observation and runs the
//                next 48 sim-hours from there.
//   historical — ERA5 archive for a user-chosen city + date range.
//                Playback starts at the first archive hour.
//   preset     — same machinery as historical, but the location + range
//                come from WEATHER_PRESETS.

import {
  fetchCurrentWeather,
  fetchForecastHourly,
  fetchHistoricalHourly,
  sampleAt,
  type GeocodedLocation,
  type WeatherSample,
  type WeatherSeries,
} from '@bas/core';
import { findPreset, type WeatherPreset } from './presets';

const LS_LAST_LOCATION = 'bas-sandbox.weather.lastLocation';

export type WeatherMode = 'off' | 'live' | 'historical' | 'preset';
export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WeatherState {
  mode: WeatherMode;
  status: WeatherStatus;
  errorMsg: string | null;
  location: GeocodedLocation | null;
  presetId: string | null;
  series: WeatherSeries | null;
  /** ISO time of the first sample in the series — the playback origin. */
  playbackStartIso: string | null;
  /** Sim-seconds elapsed since playbackStartIso. Advanced by BuildCanvas's tick. */
  playbackSimSeconds: number;
}

export const weatherStore = $state<WeatherState>({
  mode: 'off',
  status: 'idle',
  errorMsg: null,
  location: null,
  presetId: null,
  series: null,
  playbackStartIso: null,
  playbackSimSeconds: 0,
});

/**
 * Interpolate the current weather sample from the loaded series at the
 * playback clock. Returns null when no series is loaded or drive is off.
 * Cheap — call from the canvas tick loop without memoization.
 */
export function currentWeatherSample(): WeatherSample | null {
  if (weatherStore.mode === 'off') return null;
  if (!weatherStore.series || !weatherStore.playbackStartIso) return null;
  const targetMs = Date.parse(weatherStore.playbackStartIso) + weatherStore.playbackSimSeconds * 1000;
  const targetIso = new Date(targetMs).toISOString();
  return sampleAt(weatherStore.series, targetIso) ?? null;
}

/** Advance the playback clock by `dtSec` simulated seconds. No-op when off. */
export function advancePlayback(dtSec: number): void {
  if (weatherStore.mode === 'off' || !weatherStore.series) return;
  weatherStore.playbackSimSeconds += dtSec;
}

/** Reset playback to the first sample. Mode + series untouched. */
export function rewindPlayback(): void {
  weatherStore.playbackSimSeconds = 0;
}

export function setOff(): void {
  weatherStore.mode = 'off';
  weatherStore.status = 'idle';
  weatherStore.errorMsg = null;
  // Series stays in memory — re-enabling the same source shouldn't refetch.
}

/** Load live forecast for the given location and switch to live mode. */
export async function loadLive(location: GeocodedLocation): Promise<void> {
  weatherStore.status = 'loading';
  weatherStore.errorMsg = null;
  weatherStore.mode = 'live';
  weatherStore.location = location;
  weatherStore.presetId = null;

  const [current, forecast] = await Promise.all([
    fetchCurrentWeather(location.latitude, location.longitude),
    fetchForecastHourly(location.latitude, location.longitude, { hours: 48 }),
  ]);

  if (!forecast.ok) {
    weatherStore.status = 'error';
    weatherStore.errorMsg = forecast.error;
    return;
  }

  weatherStore.series = forecast.value;
  // If current observation is available, pin playback start to it so the
  // first sample shown matches the server's "now". Otherwise fall back to
  // the first hourly slot.
  weatherStore.playbackStartIso =
    (current.ok && current.value.time) ||
    forecast.value.samples[0]?.time ||
    new Date().toISOString();
  weatherStore.playbackSimSeconds = 0;
  weatherStore.status = 'ready';
  persistLocation(location);
}

/** Load historical ERA5 archive between two dates and switch to historical mode. */
export async function loadHistorical(
  location: GeocodedLocation,
  startDate: string,
  endDate: string,
): Promise<void> {
  weatherStore.status = 'loading';
  weatherStore.errorMsg = null;
  weatherStore.mode = 'historical';
  weatherStore.location = location;
  weatherStore.presetId = null;

  const res = await fetchHistoricalHourly(location.latitude, location.longitude, startDate, endDate);
  if (!res.ok) {
    weatherStore.status = 'error';
    weatherStore.errorMsg = res.error;
    return;
  }

  weatherStore.series = res.value;
  weatherStore.playbackStartIso = res.value.samples[0]?.time ?? null;
  weatherStore.playbackSimSeconds = 0;
  weatherStore.status = 'ready';
  persistLocation(location);
}

/** Load a curated preset by id. */
export async function loadPreset(presetId: string): Promise<void> {
  const preset = findPreset(presetId);
  if (!preset) {
    weatherStore.status = 'error';
    weatherStore.errorMsg = `Unknown preset: ${presetId}`;
    return;
  }
  await loadHistorical(preset.location, preset.startDate, preset.endDate);
  // loadHistorical sets mode = 'historical'; override to 'preset' so the UI
  // knows it was preset-initiated (affects which tab stays selected).
  weatherStore.mode = 'preset';
  weatherStore.presetId = presetId;
}

export function getPresetById(presetId: string): WeatherPreset | undefined {
  return findPreset(presetId);
}

/** Read last-used location from localStorage. Returns null on miss/parse error. */
export function loadLastLocation(): GeocodedLocation | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_LAST_LOCATION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeocodedLocation;
    if (typeof parsed.latitude !== 'number' || typeof parsed.longitude !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistLocation(location: GeocodedLocation): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_LAST_LOCATION, JSON.stringify(location));
  } catch {
    // localStorage full / disabled — silently skip
  }
}
