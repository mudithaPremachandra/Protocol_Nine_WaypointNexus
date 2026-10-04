import type { RuleCode } from './rules';

/** Why an order was deferred. Shown on D4, in store notices (SM2) and in the audit log. */
export type DeferralReason =
  | 'NO_REEFER_CAPACITY'
  | 'NO_VAN_CAPACITY'
  | 'CAPACITY'
  | 'TIME_BUDGET'
  | 'DELIVERY_WINDOW'
  | 'FUEL_QUOTA'
  | 'FLEET_EXHAUSTED'
  | 'VEHICLE_FAULT'
  | 'DISPATCHER_CHOICE';

export const DEFERRAL_REASONS: Record<DeferralReason, { label: string; storeText: string }> = {
  NO_REEFER_CAPACITY: {
    label: 'No refrigerated capacity',
    storeText: 'All refrigerated vehicles were full for this run.',
  },
  NO_VAN_CAPACITY: {
    label: 'No van available',
    storeText: 'Your outlet needs a small van and none had room on this run.',
  },
  CAPACITY: { label: 'Vehicles full', storeText: 'Every suitable vehicle was full for this run.' },
  TIME_BUDGET: {
    label: 'Time budget exceeded',
    storeText: 'No vehicle could reach you within its driving time for this run.',
  },
  DELIVERY_WINDOW: {
    label: 'Window unreachable',
    storeText: 'No vehicle could arrive inside your delivery window on this run.',
  },
  FUEL_QUOTA: { label: 'Weekly fuel quota', storeText: 'Suitable vehicles had used their weekly fuel allowance.' },
  FLEET_EXHAUSTED: { label: 'Fleet fully booked', storeText: 'Every suitable vehicle was already on two trips.' },
  VEHICLE_FAULT: { label: 'Vehicle fault', storeText: 'The vehicle carrying your order developed a fault.' },
  DISPATCHER_CHOICE: { label: 'Dispatcher decision', storeText: 'Dispatch moved your order to the next run.' },
};

/** Maps the rule that blocked placement to the reason recorded on the deferral. */
export function reasonForRule(rule: RuleCode, chilled: boolean, vanOnly: boolean): DeferralReason {
  switch (rule) {
    case 'WEIGHT':
    case 'VOLUME':
      return chilled ? 'NO_REEFER_CAPACITY' : vanOnly ? 'NO_VAN_CAPACITY' : 'CAPACITY';
    case 'TIME_BUDGET':
      return 'TIME_BUDGET';
    case 'DELIVERY_WINDOW':
      return 'DELIVERY_WINDOW';
    case 'FUEL_QUOTA':
      return 'FUEL_QUOTA';
    case 'MAX_TRIPS':
      return chilled ? 'NO_REEFER_CAPACITY' : vanOnly ? 'NO_VAN_CAPACITY' : 'FLEET_EXHAUSTED';
    case 'TEMPERATURE':
      return 'NO_REEFER_CAPACITY';
    case 'VAN_ACCESS':
      return 'NO_VAN_CAPACITY';
    default:
      return 'FLEET_EXHAUSTED';
  }
}
