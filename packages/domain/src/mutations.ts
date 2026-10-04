import { z } from 'zod';

/*
 * Field actions are recorded on the device first and synced later (design Dr4/DZ1). Each one is a
 * mutation with a client-generated UUID, so replaying it after a dropped connection is harmless:
 * the server applies each id at most once.
 */

const uuid = z.string().uuid();

export const LoadCheck = z.object({
  tripId: uuid,
  orderId: uuid,
  loadedUnits: z.number().int().min(0),
});

export const FlagRaise = z.object({
  flagId: uuid,
  type: z.enum(['shortfall', 'damage', 'reefer_fault', 'delivery_issue', 'receipt_issue']),
  tripId: uuid.nullish(),
  orderId: uuid.nullish(),
  item: z.string().max(120).nullish(),
  qty: z.number().int().min(0).nullish(),
  note: z.string().max(500).nullish(),
  photoId: uuid.nullish(),
});

export const TripRelease = z.object({
  tripId: uuid,
  reeferRunning: z.boolean().optional(),
});

export const TripStart = z.object({ tripId: uuid });

export const StopRecord = z.object({
  deliveryId: uuid,
  orderId: uuid,
  outcome: z.enum(['delivered', 'partial', 'failed']),
  deliveredUnits: z.number().int().min(0),
  receiverName: z.string().max(80).nullish(),
  photoId: uuid.nullish(),
  note: z.string().max(500).nullish(),
});

export const IncidentReport = z.object({
  incidentId: uuid,
  type: z.enum(['reefer_fault', 'breakdown', 'road_closed', 'accident']),
  tripId: uuid.nullish(),
  note: z.string().max(500).nullish(),
});

export const PlanAck = z.object({ version: z.number().int() });

export const ReceiptConfirm = z.object({
  receiptId: uuid,
  orderId: uuid,
  status: z.enum(['confirmed', 'issue']),
  receivedUnits: z.number().int().min(0).nullish(),
  note: z.string().max(500).nullish(),
  photoId: uuid.nullish(),
});

export const MUTATION_PAYLOADS = {
  'load.check': LoadCheck,
  'flag.raise': FlagRaise,
  'trip.release': TripRelease,
  'trip.start': TripStart,
  'stop.record': StopRecord,
  'incident.report': IncidentReport,
  'plan.ack': PlanAck,
  'receipt.confirm': ReceiptConfirm,
} as const;

export type MutationType = keyof typeof MUTATION_PAYLOADS;
export type MutationPayload<T extends MutationType> = z.infer<(typeof MUTATION_PAYLOADS)[T]>;

export const MutationEnvelope = z.object({
  /** Client-generated; the idempotency key. */
  id: uuid,
  type: z.enum(Object.keys(MUTATION_PAYLOADS) as [MutationType, ...MutationType[]]),
  /** Device clock when the action happened (ISO 8601). */
  at: z.string().datetime({ offset: true }),
  /** Plan version the device was showing. */
  baseVersion: z.number().int().nullish(),
  payload: z.unknown(),
});
export type MutationEnvelope = z.infer<typeof MutationEnvelope>;

export const SyncPushBody = z.object({ mutations: z.array(MutationEnvelope).max(200) });

export type MutationStatus = 'applied' | 'duplicate' | 'rejected';
export interface MutationResult {
  id: string;
  status: MutationStatus;
  /** Present when the server applied it but something needs a human (e.g. a possible double-serve). */
  warning?: string;
  error?: string;
}
