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
  parseIpv4,
  formatIpv4,
  networkAddress,
  isContiguousMask,
  isPrivateIpv4,
} from './ipv4.js';
export type {
  BacnetIpDevice,
  BacnetIpEdge,
  Ipv4Finding,
  Ipv4FindingId,
} from './ipv4.js';
