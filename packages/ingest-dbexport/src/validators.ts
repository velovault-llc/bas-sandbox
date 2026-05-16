import type { ValidationContext, ValidationFinding, Validator } from '@bas/core';
import { classLabel, type MetasysObject, type ParsedArchive } from '@velovault/dbexport-parser';

const REF_MATCH_RE =
  /([A-Za-z0-9][A-Za-z0-9_\-]{0,79}):([A-Za-z0-9][A-Za-z0-9_\-]{0,79})\/([A-Za-z0-9_\-.$ ()]{1,500})/g;

const PROP_DESCRIPTION = '28';
const PROP_EVENT_ENABLE = '35';

function getStringProperty(obj: MetasysObject, propId: string): string | null {
  const raw = obj.properties[propId];
  if (!raw) return null;
  const m = raw.match(/<string>([^<]*)<\/string>/);
  return m ? m[1] : null;
}

/**
 * Reference integrity: every ref-shaped string in a property XML should
 * resolve to a defined object. Ported from dbexport-viewer's unbound-refs
 * scanner; this version is the "easy mode" pass — directly-parsed property
 * XML only, no Base64Zip-wrapped graphics/programming payload decoding.
 */
export const refIntegrityValidator: Validator = {
  id: 'metasys.ref-integrity',
  displayName: 'Reference integrity',
  category: 'integrity',
  validate(ctx: ValidationContext): readonly ValidationFinding[] {
    const archive = ctx.vendor as ParsedArchive | undefined;
    if (!archive) return [];

    const validRefs = new Set<string>();
    const definedADXes = new Set<string>();
    const definedEngines = new Set<string>();
    for (const dev of archive.devices) {
      for (const obj of dev.objects) {
        if (!obj.ref) continue;
        validRefs.add(obj.ref);
        const colonIdx = obj.ref.indexOf(':');
        if (colonIdx < 0) continue;
        const slashIdx = obj.ref.indexOf('/', colonIdx + 1);
        definedADXes.add(obj.ref.slice(0, colonIdx));
        const engine =
          slashIdx >= 0 ? obj.ref.slice(colonIdx + 1, slashIdx) : obj.ref.slice(colonIdx + 1);
        if (engine) definedEngines.add(engine);
      }
    }

    const findings: ValidationFinding[] = [];
    const seen = new Set<string>();
    for (const dev of archive.devices) {
      for (const obj of dev.objects) {
        for (const [propId, rawXml] of Object.entries(obj.properties)) {
          if (!rawXml || !rawXml.includes(':')) continue;
          REF_MATCH_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = REF_MATCH_RE.exec(rawXml)) !== null) {
            const ref = m[0].replace(/[\s.,;:)\]]+$/, '');
            if (!ref.includes('/') || !ref.includes(':')) continue;
            const adx = ref.split(':', 1)[0];
            if (!/[A-Za-z]/.test(adx)) continue;
            if (adx === 'data') continue;
            // Engine-as-ADX false-positive guard: only reject when the captured
            // ADX is *exclusively* an engine name (not also a known ADX).
            if (definedEngines.has(adx) && !definedADXes.has(adx)) continue;
            if (validRefs.has(ref)) continue;
            const key = `${obj.ref}|${propId}|${ref}`;
            if (seen.has(key)) continue;
            seen.add(key);
            findings.push({
              ruleId: 'metasys.ref-integrity',
              ruleName: 'Reference integrity',
              severity: 'error',
              title: ref,
              description: `referenced by ${obj.ref} (property ${propId})`,
              subject: obj.ref,
              meta: { unresolvedRef: ref, propertyId: propId },
            });
          }
        }
      }
    }
    return findings;
  },
};

/**
 * Suppressed alarms: objects where Event Enable (prop 35) has at least one
 * transition disabled (any 0 bit in the bitstring). Ported from
 * dbexport-viewer's audit pipeline.
 */
export const suppressedAlarmsValidator: Validator = {
  id: 'metasys.suppressed-alarms',
  displayName: 'Suppressed alarms',
  category: 'safety',
  validate(ctx: ValidationContext): readonly ValidationFinding[] {
    const archive = ctx.vendor as ParsedArchive | undefined;
    if (!archive) return [];

    const findings: ValidationFinding[] = [];
    const labels = ['to-offnormal', 'to-fault', 'to-normal'];

    for (const dev of archive.devices) {
      for (const obj of dev.objects) {
        const eeRaw = obj.properties[PROP_EVENT_ENABLE];
        if (!eeRaw) continue;
        const m = eeRaw.match(/<bits[^>]*>(\d+)<\/bits>/);
        if (!m || m[1] === '111' || !/^[01]+$/.test(m[1])) continue;
        const bits = m[1];
        const disabled: string[] = [];
        for (let i = 0; i < Math.min(3, bits.length); i++) {
          if (bits[i] === '0') disabled.push(labels[i]);
        }
        if (disabled.length === 0) continue;
        const desc = getStringProperty(obj, PROP_DESCRIPTION) ?? '';
        findings.push({
          ruleId: 'metasys.suppressed-alarms',
          ruleName: 'Suppressed alarms',
          severity: 'warning',
          title: desc
            ? `${desc} — ${disabled.join(', ')} disabled`
            : `${disabled.join(', ')} disabled`,
          description: obj.ref,
          subject: obj.ref,
          meta: {
            eventEnable: bits,
            disabledTransitions: disabled,
            classLabel: classLabel(obj.classid),
          },
        });
      }
    }
    return findings;
  },
};

/**
 * Duplicate descriptions: a description (prop 28) shared by 2+ distinct refs.
 * Cross-engine duplicates are flagged as warnings (suspicious copy-paste);
 * within-engine duplicates as info (often intentional, e.g. multiple "Zone Temp"
 * sensors). Ported from dbexport-viewer.
 */
export const duplicateDescriptionsValidator: Validator = {
  id: 'metasys.duplicate-descriptions',
  displayName: 'Duplicate descriptions',
  category: 'config',
  validate(ctx: ValidationContext): readonly ValidationFinding[] {
    const archive = ctx.vendor as ParsedArchive | undefined;
    if (!archive) return [];

    const groups = new Map<string, MetasysObject[]>();
    for (const dev of archive.devices) {
      for (const obj of dev.objects) {
        const desc = getStringProperty(obj, PROP_DESCRIPTION);
        if (!desc || !desc.trim()) continue;
        const key = desc.trim();
        const arr = groups.get(key);
        if (arr) arr.push(obj);
        else groups.set(key, [obj]);
      }
    }

    const findings: ValidationFinding[] = [];
    for (const [desc, objs] of groups) {
      if (objs.length < 2) continue;
      const engines = new Set<string>();
      for (const o of objs) {
        const colonIdx = o.ref.indexOf(':');
        const slashIdx = o.ref.indexOf('/', colonIdx + 1);
        if (colonIdx >= 0) {
          engines.add(o.ref.slice(colonIdx + 1, slashIdx >= 0 ? slashIdx : undefined));
        }
      }
      const crossEngine = engines.size > 1;
      findings.push({
        ruleId: 'metasys.duplicate-descriptions',
        ruleName: 'Duplicate descriptions',
        severity: crossEngine ? 'warning' : 'info',
        title: `"${desc}"`,
        description: crossEngine
          ? `${objs.length} objects across ${engines.size} engines`
          : `${objs.length} objects in 1 engine`,
        meta: {
          count: objs.length,
          engineCount: engines.size,
          refs: objs.slice(0, 25).map((o) => o.ref),
        },
      });
    }

    // Cross-engine first (more suspicious), then by count
    findings.sort((a, b) => {
      const aMeta = a.meta as { engineCount: number; count: number };
      const bMeta = b.meta as { engineCount: number; count: number };
      if (aMeta.engineCount !== bMeta.engineCount) return bMeta.engineCount - aMeta.engineCount;
      return bMeta.count - aMeta.count;
    });

    return findings;
  },
};

export const dbexportValidators: readonly Validator[] = [
  refIntegrityValidator,
  suppressedAlarmsValidator,
  duplicateDescriptionsValidator,
];
