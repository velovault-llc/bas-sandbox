export {
  bacnetObjectId,
  bacnetUnitsForRole,
  BACNET_TYPE_PREFIX,
  RELIABILITY_LABELS,
  RELIABILITY_CODES,
  formatStatusFlags,
} from './objects.js';
export type {
  BacnetObject,
  BacnetObjectType,
  BacnetReliability,
  StatusFlags,
} from './objects.js';

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
  assignMstpAddressing,
  mstpComponents,
} from './mstp.js';
export type {
  MstpDevice,
  MstpTrunkState,
  MstpAddressingNode,
  MstpAddressingEdge,
  MstpTrunkAddressing,
  MstpAddressingResult,
  MstpComponent,
} from './mstp.js';

export {
  validateMstpTrunks,
  validateMstpTopology,
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
export {
  validateL2Vlan,
  computeBroadcastDomains,
  VLAN_MIN,
  VLAN_MAX,
} from './l2vlan.js';
export type {
  SwitchPort,
  SwitchPortMode,
  L2Switch,
  L2Link,
  L2Device,
  VlanDef,
  L2Finding,
  L2FindingId,
  BroadcastDomainResult,
} from './l2vlan.js';

export {
  COV_LIFETIME_DEFAULT_S,
  COV_RENEWAL_FRACTION,
  COV_SCAN_MIN_S,
  COV_SCAN_MAX_S,
  covRenewalDueAt,
  covExpiresAt,
  isCovRenewalDue,
  isCovLeaseExpired,
  covScanDelay,
} from './cov.js';
export type { CovLease } from './cov.js';

export {
  checkBacnetConformance,
  summarizeConformance,
} from './conformance.js';
export type {
  ConformancePacket,
  ConformanceFinding,
  ConformanceFindingId,
  ConformanceSummary,
} from './conformance.js';

export {
  BACNET_OBJECT_CATALOG,
  findObjectDef,
  requiredProperties,
  jciExtensions,
  commonProperties,
} from './objectCatalog.js';

export {
  emitWhoIs,
  emitIAm,
  emitReadProperty,
  emitReadPropertyAck,
  emitSubscribeCov,
  emitSubscribeCovAck,
  emitCovNotification,
  emitTokenPass,
  emitPollForMaster,
  emitTimeout,
  emitRegisterForeignDevice,
  emitBvlcResult,
  emitForwardedWhoIs,
  emitDistributeBroadcast,
  toConformancePacket,
} from './emit.js';
export type { BuiltPacket, Transport, Segmentation } from './emit.js';
export type {
  BacnetObjectDef,
  BacnetPropertyDef,
  BacnetObjectTypeCode,
} from './objectCatalog.js';
