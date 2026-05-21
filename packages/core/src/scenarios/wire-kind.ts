// Mirror of the UI's WireKind type for scenario specs. Kept here so
// scenario definitions can live in @bas/core without dragging the whole
// UI package in.

export type WireKind = 'mstp' | 'n2' | 'bacnet-ip' | 'lon' | 'hardwired';
