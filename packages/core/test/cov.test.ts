import { describe, it, expect } from 'vitest';
import {
  emitSubscribeCov,
  emitCovNotification,
  COV_LIFETIME_DEFAULT_S,
  COV_SCAN_MIN_S,
  COV_SCAN_MAX_S,
  covRenewalDueAt,
  covExpiresAt,
  isCovRenewalDue,
  isCovLeaseExpired,
  covScanDelay,
} from '../src/index.js';

describe('COV lease lifecycle (lab3/lab4/lab7c ground truth)', () => {
  const lease = { subscribedAtSimSec: 100, lifetimeSeconds: COV_LIFETIME_DEFAULT_S };

  it('renewal is due at exactly lifetime/2 (lab4: YABE renews at 60 s of a 120 s lease)', () => {
    expect(covRenewalDueAt(lease)).toBe(160);
    expect(isCovRenewalDue(lease, 159.9)).toBe(false);
    expect(isCovRenewalDue(lease, 160)).toBe(true);
  });

  it('un-renewed lease expires at lifetime (lab7c: silent by lease end)', () => {
    expect(covExpiresAt(lease)).toBe(220);
    expect(isCovLeaseExpired(lease, 219.9)).toBe(false);
    expect(isCovLeaseExpired(lease, 220)).toBe(true);
  });

  it('a renewed lease pushes both renewal and expiry forward', () => {
    const renewed = { subscribedAtSimSec: 160, lifetimeSeconds: 120 };
    expect(isCovLeaseExpired(renewed, 220)).toBe(false);
    expect(covRenewalDueAt(renewed)).toBe(220);
    expect(covExpiresAt(renewed)).toBe(280);
  });

  it('lifetime 0 = indefinite — never renews, never expires (spec-legal)', () => {
    const indefinite = { subscribedAtSimSec: 0, lifetimeSeconds: 0 };
    expect(isCovRenewalDue(indefinite, 1e9)).toBe(false);
    expect(isCovLeaseExpired(indefinite, 1e9)).toBe(false);
  });
});

describe('covScanDelay (lab3: bacserv scan-based detection, 0.2–7 s)', () => {
  it('stays inside the observed band', () => {
    for (let seq = 0; seq < 200; seq++) {
      const d = covScanDelay('trunk-1|vav-1|AI:1', seq);
      expect(d).toBeGreaterThanOrEqual(COV_SCAN_MIN_S);
      expect(d).toBeLessThan(COV_SCAN_MAX_S);
    }
  });

  it('is deterministic for the same (key, seq)', () => {
    expect(covScanDelay('k', 3)).toBe(covScanDelay('k', 3));
  });

  it('de-correlates across subscriptions and across sequence numbers', () => {
    expect(covScanDelay('trunk-1|vav-1|AI:1', 0)).not.toBe(covScanDelay('trunk-1|vav-2|AI:1', 0));
    expect(covScanDelay('trunk-1|vav-1|AI:1', 0)).not.toBe(covScanDelay('trunk-1|vav-1|AI:1', 1));
  });

  it('honors a custom band', () => {
    const d = covScanDelay('k', 0, 1, 2);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThan(2);
  });
});

describe('emitSubscribeCov lease threading (G48)', () => {
  it('carries the lifetime in summary and wire bytes; renewal is tagged', () => {
    const base = {
      simSec: 10,
      srcLabel: 'NAE-1',
      dstLabel: 'VAV-1',
      objectId: 'AI:1',
      deadband: 0.5,
      deadbandUnits: '°F',
    };
    const leased = emitSubscribeCov({ ...base, lifetimeSeconds: 120 });
    expect(leased.summary).toContain('lifetime 120s');
    // ctx-tag 3 unsigned 120 = 0x39 0x78 at the tail of the request.
    expect(leased.bytes?.toLowerCase().endsWith('3978')).toBe(true);

    const renewal = emitSubscribeCov({ ...base, lifetimeSeconds: 120, renewal: true });
    expect(renewal.summary).toContain('· renewal');
    // Renewal wire bytes are identical to the original subscribe.
    expect(renewal.bytes).toBe(leased.bytes);

    const indefinite = emitSubscribeCov(base);
    expect(indefinite.summary).not.toContain('lifetime');
    expect(indefinite.bytes?.toLowerCase().endsWith('3900')).toBe(true);
  });
});

describe('binary-object COV (BI/BO/BV on the wire)', () => {
  it('SubscribeCOV on a binary object reads "on change" — covIncrement is numeric-only (§13.1)', () => {
    const p = emitSubscribeCov({
      simSec: 10,
      srcLabel: 'NAE-1',
      dstLabel: 'VAV-1',
      objectId: 'BI:1',
      deadband: 0,
      lifetimeSeconds: 120,
    });
    expect(p.summary).toContain('(on change, lifetime 120s)');
    expect(p.summary).not.toContain('deadband');
    expect(p.bytes).toBeDefined(); // BI type code now known to the encoder
  });

  it('binary notification carries ENUMERATED present-value and renders active/inactive', () => {
    const active = emitCovNotification({
      simSec: 10,
      srcLabel: 'VAV-1',
      dstLabel: 'NAE-1',
      objectId: 'BV:2',
      value: 1,
    });
    expect(active.summary).toContain('present-value=active');
    // listOfValues PV wrapped in ctx tag 2: opening 0x2e, Enumerated
    // tag+len 0x91, value 0x01, closing 0x2f.
    expect(active.bytes?.toLowerCase()).toContain('2e91012f');

    const inactive = emitCovNotification({
      simSec: 10,
      srcLabel: 'VAV-1',
      dstLabel: 'NAE-1',
      objectId: 'BI:1',
      value: 0,
    });
    expect(inactive.summary).toContain('present-value=inactive');
    expect(inactive.bytes?.toLowerCase()).toContain('2e91002f');
  });

  it('analog notification still encodes Real (tag 0x44)', () => {
    const p = emitCovNotification({
      simSec: 10,
      srcLabel: 'VAV-1',
      dstLabel: 'NAE-1',
      objectId: 'AO:1',
      value: 42.5,
    });
    expect(p.summary).toContain('present-value=42.5');
    expect(p.bytes?.toLowerCase()).toContain('2e44'); // ctx-2 open + Real tag
  });
});
