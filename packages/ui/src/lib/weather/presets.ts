// Curated weather scenarios for the BAS sandbox.
//
// Each preset pins a city + a historical week from the ERA5 archive that
// hits a specific climate stressor a tech or design engineer would want to
// test against:
//   - extreme heat / cold drive the envelope hard
//   - high diurnal swing exercises night setback + morning recovery
//   - mild shoulder season is the "everything should coast" baseline
//
// Dates are 2025 — old enough for ERA5 to have settled (lag ~5 days), recent
// enough to feel current.

import type { GeocodedLocation } from '@bas/core';

export interface WeatherPreset {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly location: GeocodedLocation;
  readonly startDate: string;
  readonly endDate: string;
}

export const WEATHER_PRESETS: readonly WeatherPreset[] = [
  {
    id: 'phoenix-august',
    label: 'Phoenix · August',
    note: 'Extreme heat — cooling plant runs flat-out, economizer useless',
    location: {
      name: 'Phoenix',
      country: 'United States',
      admin1: 'Arizona',
      latitude: 33.4484,
      longitude: -112.074,
      timezone: 'America/Phoenix',
    },
    startDate: '2025-08-01',
    endDate: '2025-08-07',
  },
  {
    id: 'chicago-january',
    label: 'Chicago · January',
    note: 'Deep cold — heating mode + freeze-stat territory',
    location: {
      name: 'Chicago',
      country: 'United States',
      admin1: 'Illinois',
      latitude: 41.8781,
      longitude: -87.6298,
      timezone: 'America/Chicago',
    },
    startDate: '2025-01-15',
    endDate: '2025-01-22',
  },
  {
    id: 'denver-april',
    label: 'Denver · April',
    note: 'High diurnal swing — exercises night setback + morning recovery',
    location: {
      name: 'Denver',
      country: 'United States',
      admin1: 'Colorado',
      latitude: 39.7392,
      longitude: -104.9903,
      timezone: 'America/Denver',
    },
    startDate: '2025-04-15',
    endDate: '2025-04-22',
  },
  {
    id: 'miami-july',
    label: 'Miami · July',
    note: 'Hot + humid — latent load dominates, dehumidification matters',
    location: {
      name: 'Miami',
      country: 'United States',
      admin1: 'Florida',
      latitude: 25.7617,
      longitude: -80.1918,
      timezone: 'America/New_York',
    },
    startDate: '2025-07-15',
    endDate: '2025-07-22',
  },
  {
    id: 'atlanta-april',
    label: 'Atlanta · April',
    note: 'Mild shoulder — baseline; plant should coast with free cooling',
    location: {
      name: 'Atlanta',
      country: 'United States',
      admin1: 'Georgia',
      latitude: 33.749,
      longitude: -84.388,
      timezone: 'America/New_York',
    },
    startDate: '2025-04-01',
    endDate: '2025-04-07',
  },
  {
    id: 'seattle-november',
    label: 'Seattle · November',
    note: 'Cool + overcast + wet — minimal solar gain, cold-deck stays cold',
    location: {
      name: 'Seattle',
      country: 'United States',
      admin1: 'Washington',
      latitude: 47.6062,
      longitude: -122.3321,
      timezone: 'America/Los_Angeles',
    },
    startDate: '2025-11-10',
    endDate: '2025-11-17',
  },
];

export function findPreset(id: string): WeatherPreset | undefined {
  return WEATHER_PRESETS.find((p) => p.id === id);
}
