// SpecLang — plain-English BAS programming.
//
// Users assemble TILES into RULES. A rule reads like a G36 spec sentence:
//
//   When zone temp exceeds cooling setpoint by 1°F
//     → Open primary damper to 100%
//
// Under the hood each rule compiles to a single Structured Text IF/THEN
// statement. A program is an ordered list of rules — later rules can
// override earlier ones (last-write-wins on the actuator output), which
// matches how real G36 sequences layer base loops + setbacks + safeties.

/** What role a tile plays in a rule. Used by the grammar to decide which
 *  tiles can follow which. */
export type TileKind =
  | 'trigger'    // When, While, On change of, At time
  | 'action'     // Open, Close, Modulate, Set, Shut down, Alarm
  | 'subject'    // zone temp, OA temp, occupancy, damper position, …
  | 'actuator'   // primary damper, reheat valve, supply fan
  | 'operator'   // exceeds, is below, equals, by, to, at, between
  | 'value'      // 72°F, 100%, 1°F, 600 ppm
  | 'literal';   // occupied, vacant, on, off

/** A tile placed in a rule. `token` is the canonical id used by the
 *  compiler; `display` is what the user sees on the chip. */
export interface Tile {
  readonly id: string;            // canvas instance id (unique per tile placed)
  readonly kind: TileKind;
  readonly token: string;         // canonical id (eg 'zone-temp', 'exceeds')
  readonly display: string;       // user-facing label
  readonly numericValue?: number; // populated for VALUE tiles
  readonly units?: string;        // populated for VALUE tiles ('°F', '%', 'ppm')
}

/** One assembled rule. Tiles in order — the grammar lays out which
 *  sequences are well-formed; the compiler rejects mal-formed ones. */
export interface SpecRule {
  readonly id: string;
  readonly tiles: readonly Tile[];
}

/** A complete SpecLang program for one controller. */
export interface SpecProgram {
  readonly rules: readonly SpecRule[];
}

/**
 * One physical-terminal → logical-role mapping. Created explicitly by the
 * user in the Point Assignment panel before they write rules. This is the
 * commissioning point-list: "UI-1 is the zone temp sensor", "AO-1 drives
 * the primary damper", etc. Once bound, the SpecLang compiler can warn if
 * a rule references a role that has no physical point behind it.
 */
export interface PointBinding {
  /** Physical terminal id on the controller, e.g. "UI-1", "AO-2", "BO-3". */
  readonly terminalId: string;
  /** Canonical role token from the SUBJECT or ACTUATOR tile catalog —
   *  e.g. "zone-temp", "occupancy", "primary-damper". */
  readonly role: string;
  /** For inputs: the canvas node id of the sensor wired to this terminal.
   *  For outputs: undefined (the actuator is the terminal itself in our
   *  current model). */
  readonly sourceNodeId?: string;
  /** Free-text note the technician can add — eg "wire run from RM 203
   *  east wall to panel J3" — for the commissioning report. */
  readonly note?: string;
}

/** All point bindings for one controller. Stored in the program store
 *  alongside the SpecLang rules. */
export interface ControllerBindings {
  readonly bindings: readonly PointBinding[];
}

/** Catalog entry for a draggable tile in the palette. */
export interface TileTemplate {
  readonly kind: TileKind;
  readonly token: string;
  readonly display: string;
  /** Short blurb shown on hover — explains what the tile does. */
  readonly description: string;
  /** For SUBJECT / ACTUATOR tiles: the env input key the compiler
   *  references. Eg 'sensed' for zone temp, 'occ' for occupancy. */
  readonly envKey?: string;
  /** True for SUBJECT tiles that represent controller-internal values
   *  (setpoints, schedules, calculated values) rather than physical
   *  inputs. The Point Assignment validator skips these — you can't
   *  bind "cooling setpoint" to a UI terminal because it's not a
   *  physical signal. */
  readonly internal?: boolean;
  /** Default value for VALUE tiles. */
  readonly defaultNumeric?: number;
  readonly defaultUnits?: string;
}
