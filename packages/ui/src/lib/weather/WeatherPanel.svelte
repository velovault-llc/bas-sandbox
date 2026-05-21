<script lang="ts">
  import {
    geocodeCity,
    OPEN_METEO_ATTRIBUTION,
    type GeocodedLocation,
  } from '@bas/core';
  import {
    weatherStore,
    currentWeatherSample,
    loadHistorical,
    loadLastLocation,
    loadLive,
    loadPreset,
    rewindPlayback,
    setOff,
    type WeatherMode,
  } from './weatherStore.svelte';
  import { WEATHER_PRESETS } from './presets';
  import { CITY_GROUPS, cityId, ALL_CITIES } from './cities';

  type Tab = 'live' | 'historical' | 'preset';
  const TABS: readonly { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'historical', label: 'Historical' },
    { id: 'preset', label: 'Preset' },
  ];
  let activeTab = $state<Tab>(weatherStore.mode === 'off' ? 'live' : tabForMode(weatherStore.mode));

  let query = $state('');
  let searchResults = $state<readonly GeocodedLocation[]>([]);
  let searching = $state(false);
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  let historicalStart = $state(defaultHistoricalStart());
  let historicalEnd = $state(defaultHistoricalEnd());
  let presetId = $state(WEATHER_PRESETS[0].id);
  let selectedCityId = $state('');

  async function onPickMajorCity(): Promise<void> {
    if (!selectedCityId) return;
    const loc = ALL_CITIES.find((c) => cityId(c) === selectedCityId);
    if (!loc) return;
    query = formatLocationLabel(loc);
    searchResults = [];
    if (activeTab === 'historical') {
      await loadHistorical(loc, historicalStart, historicalEnd);
    } else {
      await loadLive(loc);
    }
  }

  // Seed from localStorage so a returning user finds their last city pre-filled.
  $effect(() => {
    const last = loadLastLocation();
    if (last && !query) query = last.name;
  });

  const currentSample = $derived(currentWeatherSample());
  const seriesSummary = $derived.by(() => {
    const s = weatherStore.series;
    if (!s || s.samples.length === 0) return null;
    const first = s.samples[0];
    const last = s.samples[s.samples.length - 1];
    let tMin = first.T_F;
    let tMax = first.T_F;
    for (const sample of s.samples) {
      if (sample.T_F < tMin) tMin = sample.T_F;
      if (sample.T_F > tMax) tMax = sample.T_F;
    }
    return {
      first: first.time,
      last: last.time,
      count: s.samples.length,
      tMin,
      tMax,
    };
  });

  function tabForMode(m: WeatherMode): Tab {
    if (m === 'historical') return 'historical';
    if (m === 'preset') return 'preset';
    return 'live';
  }

  function defaultHistoricalStart(): string {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  }
  function defaultHistoricalEnd(): string {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }

  function scheduleSearch(): void {
    if (searchDebounce) clearTimeout(searchDebounce);
    if (query.trim().length < 2) {
      searchResults = [];
      return;
    }
    searchDebounce = setTimeout(runSearch, 250);
  }

  async function runSearch(): Promise<void> {
    searching = true;
    const res = await geocodeCity(query, { count: 6 });
    if (res.ok) searchResults = res.value;
    searching = false;
  }

  async function pickLocationLive(loc: GeocodedLocation): Promise<void> {
    searchResults = [];
    query = formatLocationLabel(loc);
    await loadLive(loc);
  }

  async function pickLocationHistorical(loc: GeocodedLocation): Promise<void> {
    searchResults = [];
    query = formatLocationLabel(loc);
    await loadHistorical(loc, historicalStart, historicalEnd);
  }

  async function reloadHistorical(): Promise<void> {
    if (!weatherStore.location) return;
    await loadHistorical(weatherStore.location, historicalStart, historicalEnd);
  }

  async function loadSelectedPreset(): Promise<void> {
    await loadPreset(presetId);
  }

  async function useMyLocation(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      weatherStore.status = 'error';
      weatherStore.errorMsg = 'Geolocation not available in this browser.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc: GeocodedLocation = {
          name: 'My location',
          country: '',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        };
        query = `${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`;
        await loadLive(loc);
      },
      (err) => {
        weatherStore.status = 'error';
        weatherStore.errorMsg = `Geolocation: ${err.message}`;
      },
      { timeout: 8000 },
    );
  }

  function formatLocationLabel(loc: GeocodedLocation): string {
    const parts = [loc.name];
    if (loc.admin1) parts.push(loc.admin1);
    if (loc.country) parts.push(loc.country);
    return parts.join(', ');
  }

  function formatPlaybackClock(): string {
    if (!weatherStore.playbackStartIso) return '—';
    const ms = Date.parse(weatherStore.playbackStartIso) + weatherStore.playbackSimSeconds * 1000;
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<section class="weather-panel" aria-label="Weather drive">
  <header class="panel-head">
    <h3>Weather drive</h3>
    {#if weatherStore.mode !== 'off'}
      <button type="button" class="off-btn" onclick={setOff} title="Stop driving from weather">
        Turn off
      </button>
    {/if}
  </header>

  <div class="tabs" role="tablist">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === tab.id}
        class:active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  {#if activeTab === 'live'}
    <div class="tab-body">
      <label class="field">
        <span>Quick pick</span>
        <select bind:value={selectedCityId} onchange={onPickMajorCity}>
          <option value="">— major city —</option>
          {#each CITY_GROUPS as group}
            <optgroup label={group.label}>
              {#each group.cities as c (cityId(c))}
                <option value={cityId(c)}>{c.name}{c.admin1 ? `, ${c.admin1}` : ''}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>Or search any city</span>
        <input
          type="text"
          placeholder="Chicago, Phoenix, Tokyo…"
          bind:value={query}
          oninput={scheduleSearch}
        />
      </label>
      <button type="button" class="locate-btn" onclick={useMyLocation}>
        📍 Use my location
      </button>

      {#if searching}
        <p class="hint">Searching…</p>
      {/if}
      {#if searchResults.length > 0}
        <ul class="results">
          {#each searchResults as loc}
            <li>
              <button type="button" onclick={() => pickLocationLive(loc)}>
                <strong>{loc.name}</strong>
                {#if loc.admin1}<span class="muted">, {loc.admin1}</span>{/if}
                {#if loc.country}<span class="muted">· {loc.country}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if activeTab === 'historical'}
    <div class="tab-body">
      <label class="field">
        <span>Quick pick</span>
        <select bind:value={selectedCityId} onchange={onPickMajorCity}>
          <option value="">— major city —</option>
          {#each CITY_GROUPS as group}
            <optgroup label={group.label}>
              {#each group.cities as c (cityId(c))}
                <option value={cityId(c)}>{c.name}{c.admin1 ? `, ${c.admin1}` : ''}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>Or search any city</span>
        <input
          type="text"
          placeholder="Chicago, Phoenix, Tokyo…"
          bind:value={query}
          oninput={scheduleSearch}
        />
      </label>
      <div class="date-row">
        <label class="field">
          <span>Start</span>
          <input type="date" bind:value={historicalStart} />
        </label>
        <label class="field">
          <span>End</span>
          <input type="date" bind:value={historicalEnd} />
        </label>
      </div>

      {#if searching}
        <p class="hint">Searching…</p>
      {/if}
      {#if searchResults.length > 0}
        <ul class="results">
          {#each searchResults as loc}
            <li>
              <button type="button" onclick={() => pickLocationHistorical(loc)}>
                <strong>{loc.name}</strong>
                {#if loc.admin1}<span class="muted">, {loc.admin1}</span>{/if}
                {#if loc.country}<span class="muted">· {loc.country}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else if weatherStore.location && weatherStore.mode === 'historical'}
        <button type="button" class="reload-btn" onclick={reloadHistorical}>
          Reload {formatLocationLabel(weatherStore.location)} for new dates
        </button>
      {/if}
      <p class="hint">ERA5 archive lags ~5 days. Pick dates older than a week.</p>
    </div>
  {/if}

  {#if activeTab === 'preset'}
    <div class="tab-body">
      <label class="field">
        <span>Scenario</span>
        <select bind:value={presetId}>
          {#each WEATHER_PRESETS as p}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </label>
      {#each WEATHER_PRESETS as p}
        {#if p.id === presetId}
          <p class="preset-note">{p.note}</p>
        {/if}
      {/each}
      <button type="button" class="primary-btn" onclick={loadSelectedPreset}>
        Load scenario
      </button>
    </div>
  {/if}

  {#if weatherStore.status === 'loading'}
    <div class="status loading">Loading weather…</div>
  {/if}
  {#if weatherStore.status === 'error' && weatherStore.errorMsg}
    <div class="status error" role="alert">{weatherStore.errorMsg}</div>
  {/if}

  {#if weatherStore.status === 'ready' && weatherStore.location && currentSample}
    <div class="status ready">
      <div class="status-line">
        <span class="muted">Driving from</span>
        <strong>{formatLocationLabel(weatherStore.location)}</strong>
        <span class="muted">·</span>
        <span class="mode-pill" class:live={weatherStore.mode === 'live'}>
          {weatherStore.mode === 'live'
            ? 'Live forecast'
            : weatherStore.mode === 'preset'
              ? 'Preset'
              : 'Historical'}
        </span>
      </div>
      <div class="metrics">
        <div class="metric">
          <span class="metric-label">OAT</span>
          <span class="metric-value">{currentSample.T_F.toFixed(1)}°F</span>
        </div>
        <div class="metric">
          <span class="metric-label">RH</span>
          <span class="metric-value">{currentSample.RH.toFixed(0)}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">Wind</span>
          <span class="metric-value">{currentSample.windMph.toFixed(1)} mph</span>
        </div>
        <div class="metric">
          <span class="metric-label">Clouds</span>
          <span class="metric-value">{currentSample.cloudPct.toFixed(0)}%</span>
        </div>
      </div>
      <div class="status-line">
        <span class="muted">Sim clock</span>
        <strong class="mono">{formatPlaybackClock()}</strong>
        <button type="button" class="rewind-btn" onclick={rewindPlayback} title="Rewind to start">
          ⟲ Rewind
        </button>
      </div>
      {#if seriesSummary}
        <div class="series-summary muted">
          {seriesSummary.count.toLocaleString()} hourly samples · {seriesSummary.tMin.toFixed(0)}–{seriesSummary.tMax.toFixed(0)}°F range
        </div>
      {/if}
    </div>
  {/if}

  <footer class="attribution">{OPEN_METEO_ATTRIBUTION}</footer>
</section>

<style>
  .weather-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, Canvas 92%, CanvasText 4%);
    font-size: 0.85rem;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h3 {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .off-btn {
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    color: color-mix(in srgb, CanvasText 70%, transparent);
    padding: 0.15rem 0.55rem;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.75rem;
  }

  .off-btn:hover {
    background: color-mix(in srgb, CanvasText 5%, transparent);
  }

  .tabs {
    display: flex;
    border: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
    border-radius: 6px;
    overflow: hidden;
  }

  .tabs button {
    flex: 1;
    background: transparent;
    border: 0;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    color: inherit;
    font-size: 0.8rem;
  }

  .tabs button.active {
    background: color-mix(in srgb, CanvasText 12%, transparent);
    font-weight: 600;
  }

  .tabs button:not(.active):hover {
    background: color-mix(in srgb, CanvasText 5%, transparent);
  }

  .tab-body {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
  }

  .field span {
    color: color-mix(in srgb, CanvasText 65%, transparent);
  }

  .field input,
  .field select {
    padding: 0.3rem 0.45rem;
    border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
    border-radius: 5px;
    background: Canvas;
    color: inherit;
    font: inherit;
  }

  .date-row {
    display: flex;
    gap: 0.55rem;
  }

  .date-row .field {
    flex: 1;
  }

  .locate-btn,
  .reload-btn,
  .primary-btn,
  .rewind-btn {
    align-self: flex-start;
    background: transparent;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    color: inherit;
    padding: 0.3rem 0.6rem;
    border-radius: 5px;
    cursor: pointer;
    font-size: 0.78rem;
  }

  .primary-btn {
    background: color-mix(in srgb, #4a9eff 70%, Canvas);
    color: white;
    border-color: transparent;
  }

  .primary-btn:hover {
    background: #4a9eff;
  }

  .rewind-btn {
    margin-left: auto;
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
  }

  .locate-btn:hover,
  .reload-btn:hover,
  .rewind-btn:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
    border-radius: 5px;
    max-height: 10rem;
    overflow-y: auto;
  }

  .results li {
    border-bottom: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
  }

  .results li:last-child {
    border-bottom: 0;
  }

  .results button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 0;
    color: inherit;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
    font-size: 0.82rem;
  }

  .results button:hover {
    background: color-mix(in srgb, CanvasText 6%, transparent);
  }

  .muted {
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .mono {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
  }

  .hint {
    margin: 0.1rem 0 0;
    font-size: 0.72rem;
    color: color-mix(in srgb, CanvasText 55%, transparent);
  }

  .preset-note {
    margin: 0;
    font-size: 0.78rem;
    color: color-mix(in srgb, CanvasText 70%, transparent);
    font-style: italic;
  }

  .status {
    border-top: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
    padding-top: 0.55rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .status.loading {
    color: color-mix(in srgb, CanvasText 65%, transparent);
    font-style: italic;
  }

  .status.error {
    color: #e74c3c;
    font-size: 0.8rem;
  }

  .status-line {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    flex-wrap: wrap;
  }

  .mode-pill {
    font-size: 0.7rem;
    padding: 0.1rem 0.45rem;
    border-radius: 8px;
    background: color-mix(in srgb, CanvasText 12%, transparent);
  }

  .mode-pill.live {
    background: color-mix(in srgb, #4a9eff 60%, Canvas);
    color: white;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
  }

  .metric {
    display: flex;
    flex-direction: column;
    padding: 0.3rem 0.4rem;
    background: color-mix(in srgb, CanvasText 6%, transparent);
    border-radius: 4px;
    text-align: center;
  }

  .metric-label {
    font-size: 0.65rem;
    color: color-mix(in srgb, CanvasText 60%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .metric-value {
    font-size: 0.92rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .series-summary {
    font-size: 0.72rem;
  }

  .attribution {
    font-size: 0.7rem;
    color: color-mix(in srgb, CanvasText 50%, transparent);
    border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent);
    padding-top: 0.4rem;
  }
</style>
