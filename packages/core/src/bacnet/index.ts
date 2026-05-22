export {
  bacnetObjectId,
  bacnetUnitsForRole,
  BACNET_TYPE_PREFIX,
} from './objects.js';
export type { BacnetObject, BacnetObjectType } from './objects.js';

export { synthesizeBacnetObjects } from './synthesize.js';
export type { SynthesizeInputs } from './synthesize.js';

export {
  stepMstpToken,
  initMstpTrunkState,
  tokenHoldSeconds,
  formatMstpDevice,
  defaultDeviceInstance,
  mstpServiceLatencySeconds,
  BACNET_IP_RTT_SECONDS,
} from './mstp.js';
export type { MstpDevice, MstpTrunkState } from './mstp.js';

export {
  validateMstpTrunks,
  MSTP_TRUNK_RECOMMENDED_MAX_DEVICES,
  MSTP_MAC_MIN,
  MSTP_MAC_MAX,
} from './validate.js';
export type { MstpFinding, MstpFindingId, MstpTrunkSnapshot } from './validate.js';

export {
  validateBacnetIpNetwork,
  validateIpZones,
  parseIpv4,
  formatIpv4,
  networkAddress,
  isContiguousMask,
  isPrivateIpv4,
  parseCidr,
  ipInCidr,
  formatCidr,
} from './ipv4.js';
export type {
  BacnetIpDevice,
  BacnetIpEdge,
  BacnetIpRouter,
  Ipv4Finding,
  Ipv4FindingId,
  ParsedCidr,
  PlacedBacnetIpDevice,
  SubnetZone,
} from './ipv4.js';
