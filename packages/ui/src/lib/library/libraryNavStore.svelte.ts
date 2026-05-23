// Tiny cross-component channel so anything in the app can request
// "open the Library tab and seed search with this string". Used by
// the conformance panel's citation pills to deep-link into the
// matching library entries.
//
// Pulse-style store: bump `pulse` to fire, listeners read `query`.

export const libraryNavStore = $state({
  pulse: 0,
  query: '',
});

/** Request that the Library tab open with the given search query.
 *  If called with an empty string, just opens the tab. */
export function navigateToLibrary(query = ''): void {
  libraryNavStore.query = query;
  libraryNavStore.pulse += 1;
}
