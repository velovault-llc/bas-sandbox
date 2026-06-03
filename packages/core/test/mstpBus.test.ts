import { describe, it, expect } from 'vitest';
import {
  initMstpBus,
  defaultMstpBusConfig,
  makeFrame,
  enqueueFrame,
  stepBus,
  frameTimeSec,
  octetTimeSec,
  FRAME_DATA_OCTETS,
} from '../src/bacnet/mstpBus.js';

function rpRequest(srcMac: number, dstMac: number, at: number) {
  return makeFrame({
    srcMac,
    dstMac,
    kind: 'request',
    dataOctets: FRAME_DATA_OCTETS.readPropertyRequest,
    confirmed: true,
    replyOctets: FRAME_DATA_OCTETS.readPropertyAck,
    enqueuedSec: at,
    service: 'ReadProperty',
  });
}

function covNotif(srcMac: number, at: number) {
  return makeFrame({
    srcMac,
    dstMac: 0,
    kind: 'unconfirmed',
    dataOctets: FRAME_DATA_OCTETS.covNotification,
    confirmed: false,
    enqueuedSec: at,
    service: 'COVNotification',
  });
}

describe('MS/TP bus timing primitives', () => {
  it('octet time scales inversely with baud', () => {
    expect(octetTimeSec(38400)).toBeCloseTo(10 / 38400, 9);
    expect(octetTimeSec(9600)).toBeGreaterThan(octetTimeSec(38400));
  });

  it('a data frame takes longer than a header-only frame', () => {
    expect(frameTimeSec(38400, 20)).toBeGreaterThan(frameTimeSec(38400, 0));
  });
});

describe('MS/TP bus — light load', () => {
  it('serves a single request quickly with low utilisation', () => {
    const bus = initMstpBus([0, 3], defaultMstpBusConfig(38400));
    enqueueFrame(bus, 0, rpRequest(0, 3, 0));
    const r = stepBus(bus, 1.0);
    expect(r.framesSent).toBe(1);
    expect(r.backlog).toBe(0);
    expect(r.completed).toHaveLength(1);
    expect(r.completed[0].latencySec).toBeLessThan(0.1);
    expect(r.utilisation).toBeLessThan(0.05);
  });

  it('an idle bus does no work and reports zero utilisation', () => {
    const bus = initMstpBus([0, 3, 7]);
    const r = stepBus(bus, 1.0);
    expect(r.framesSent).toBe(0);
    expect(r.backlog).toBe(0);
    expect(r.utilisation).toBe(0);
    expect(bus.simSec).toBeCloseTo(1.0, 9);
  });
});

describe('MS/TP bus — congestion', () => {
  it('saturates and backs up when offered more than the bus can carry', () => {
    // Slow trunk, lots of confirmed polls offered at once.
    const bus = initMstpBus([0], { baud: 9600, maxInfoFrames: 1, maxQueue: 1000 });
    for (let i = 0; i < 300; i++) enqueueFrame(bus, 0, rpRequest(0, 5, 0));
    const r = stepBus(bus, 1.0);

    expect(r.utilisation).toBeGreaterThan(0.7); // bus is busy
    expect(r.framesSent).toBeLessThan(300); // can't clear them all in 1s
    expect(r.backlog).toBeGreaterThan(100); // real backlog remains
  });

  it('latency climbs for frames stuck behind a saturated queue', () => {
    const bus = initMstpBus([0], { baud: 9600, maxInfoFrames: 1, maxQueue: 1000 });
    for (let i = 0; i < 50; i++) enqueueFrame(bus, 0, covNotif(0, 0));
    const r = stepBus(bus, 1.0);
    expect(r.completed.length).toBeGreaterThan(1);
    const first = r.completed[0].latencySec;
    const last = r.completed[r.completed.length - 1].latencySec;
    expect(last).toBeGreaterThan(first); // each frame waited longer than the previous
  });

  it('higher Max_Info_Frames raises throughput (less token overhead)', () => {
    const mk = (mif: number) => {
      const bus = initMstpBus([0], { baud: 9600, maxInfoFrames: mif, maxQueue: 1000 });
      for (let i = 0; i < 300; i++) enqueueFrame(bus, 0, rpRequest(0, 5, 0));
      return stepBus(bus, 1.0).framesSent;
    };
    expect(mk(8)).toBeGreaterThan(mk(1));
  });

  it('drops frames offered to a full queue (COV-storm loss path)', () => {
    const bus = initMstpBus([0], { baud: 38400, maxInfoFrames: 1, maxQueue: 8 });
    let accepted = 0;
    for (let i = 0; i < 50; i++) {
      if (enqueueFrame(bus, 0, covNotif(0, 0))) accepted++;
    }
    expect(accepted).toBe(8);
    expect(bus.droppedTotal).toBe(42);
  });
});
