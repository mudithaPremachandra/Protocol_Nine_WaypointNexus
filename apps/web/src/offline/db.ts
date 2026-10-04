import Dexie, { type Table } from 'dexie';
import type { MutationType } from '@wn/domain';

/** A field action recorded on the device, waiting for (or done with) sync. */
export interface OutboxItem {
  id: string;
  type: MutationType;
  payload: unknown;
  at: string;
  baseVersion: number | null;
  /** Human label for the sync screen (Dr4), e.g. "Stop 3, Peradeniya". */
  label: string;
  detail: string;
  status: 'queued' | 'synced' | 'rejected';
  error?: string;
  warning?: string;
  createdAt: number;
  syncedAt?: number;
}

export interface PhotoItem {
  id: string;
  blob: Blob;
  label: string;
  status: 'queued' | 'synced';
  createdAt: number;
  syncedAt?: number;
}

/** Last server snapshot per screen scope, so loader and driver screens open with no signal. */
export interface SnapshotItem {
  key: string;
  data: unknown;
  version: number;
  savedAt: number;
  /** Driver only: the plan version and stop list the driver last accepted (DZ1). */
  acceptedVersion?: number;
  acceptedStops?: { tripNo: number; orderId: string; outletName: string; orderNo: string }[];
}

/** A GPS fix from the driver's phone, queued for upload separately from the outbox. */
export interface PingItem {
  id: string;
  vehicleId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
  createdAt: number;
}

class NexusDB extends Dexie {
  pings!: Table<PingItem, string>;
  outbox!: Table<OutboxItem, string>;
  photos!: Table<PhotoItem, string>;
  snapshots!: Table<SnapshotItem, string>;
  constructor() {
    super('waypoint-nexus');
    this.version(1).stores({
      outbox: 'id, status, createdAt',
      photos: 'id, status, createdAt',
      snapshots: 'key',
    });
    this.version(2).stores({ pings: 'id, createdAt' });
  }
}

export const db = new NexusDB();

export async function wipeLocal() {
  await Promise.all([db.outbox.clear(), db.photos.clear(), db.snapshots.clear(), db.pings.clear()]);
}
