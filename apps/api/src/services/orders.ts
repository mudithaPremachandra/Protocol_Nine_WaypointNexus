import { and, desc, eq, inArray, sql as dsql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import * as s from '../db/schema';
import { getState } from '../lib/appState';
import { formatDay, nextOperatingDate } from '../lib/dates';
import { badRequest } from '../lib/errors';
import { emit, type AuthUser } from '../lib/events';

export const PlaceOrderBody = z.object({
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(2000) })).min(1).max(30),
  note: z.string().max(300).optional(),
});

const PREFIX: Record<string, string> = { Fresh: 'WF', Style: 'WS', Tech: 'WT' };

async function nextOrderNo(brand: string): Promise<string> {
  const [row] = await db.select({ max: dsql<number>`max(cast(substring(${s.orders.orderNo} from 4) as int))` }).from(s.orders);
  return `${PREFIX[brand] ?? 'WX'}-${Number(row?.max ?? 30000) + 1}`;
}

/**
 * Store order (SM1): counted in cases and crates; Waypoint derives weight and volume from the
 * catalogue. Fresh outlets get separate dry and chilled orders, as the brief describes, because
 * chilled goods need a refrigerated vehicle. Orders after the cutoff join the next run, visibly.
 */
export async function placeOrder(user: AuthUser, body: z.infer<typeof PlaceOrderBody>) {
  const { serviceDate, cutoffClosed } = await getState(db);
  const [outlet] = await db.select().from(s.outlets).where(eq(s.outlets.id, user.outletId!));
  if (!outlet) throw badRequest('Your account is not linked to a store');
  const products = await db.select().from(s.products).where(inArray(s.products.id, body.lines.map((l) => l.productId)));
  for (const l of body.lines) {
    const p = products.find((x) => x.id === l.productId);
    if (!p || p.brand !== outlet.brand) throw badRequest(`${l.productId} is not in the ${outlet.brand} catalogue`);
  }

  const requestedDate = cutoffClosed ? await nextOperatingDate(db, serviceDate) : serviceDate;
  const byTemp = new Map<string, typeof body.lines>();
  for (const l of body.lines) {
    const temp = products.find((p) => p.id === l.productId)!.temp;
    byTemp.set(temp, [...(byTemp.get(temp) ?? []), l]);
  }

  const created = [];
  for (const [temp, lines] of byTemp) {
    let units = 0;
    let weightKg = 0;
    let volumeM3 = 0;
    for (const l of lines) {
      const p = products.find((x) => x.id === l.productId)!;
      units += l.qty;
      weightKg += p.weightKg * l.qty;
      volumeM3 += p.volumeM3 * l.qty;
    }
    const orderNo = await nextOrderNo(outlet.brand);
    const [order] = await db
      .insert(s.orders)
      .values({
        orderNo,
        outletId: outlet.id,
        brand: outlet.brand,
        district: outlet.district,
        depot: outlet.depot,
        temp,
        requestedDate,
        units,
        weightKg: Math.round(weightKg * 10) / 10,
        volumeM3: Math.round(volumeM3 * 1000) / 1000,
        status: cutoffClosed ? 'queued' : 'placed',
        placedBy: user.id,
        afterCutoff: cutoffClosed,
        note: body.note ?? null,
      })
      .returning();
    await db.insert(s.orderLines).values(lines.map((l) => ({ orderId: order!.id, productId: l.productId, qty: l.qty })));
    created.push(order!);
  }

  await emit(db, {
    type: 'order.placed',
    actor: user,
    date: requestedDate,
    scope: { roles: ['dispatcher'], outletIds: [outlet.id] },
    payload: {
      orderNos: created.map((o) => o.orderNo),
      afterCutoff: cutoffClosed,
      message: `${outlet.name} placed ${created.map((o) => o.orderNo).join(' and ')} for ${formatDay(requestedDate)}${cutoffClosed ? ' (after cutoff, next run)' : ''}`,
    },
  });
  return { orders: created, requestedDate, requestedDay: formatDay(requestedDate), afterCutoff: cutoffClosed };
}

export async function productsFor(user: AuthUser) {
  const [outlet] = await db.select().from(s.outlets).where(eq(s.outlets.id, user.outletId!));
  return db.select().from(s.products).where(eq(s.products.brand, outlet?.brand ?? 'Fresh'));
}

/** D1: one queue, with the constraint badges that used to live in the dispatcher's head. */
export async function orderQueue() {
  const { serviceDate, cutoffClosed } = await getState(db);
  const [orders, outlets] = await Promise.all([
    db.select().from(s.orders).where(eq(s.orders.requestedDate, serviceDate)).orderBy(desc(s.orders.deferredYesterday), s.orders.depot, s.orders.brand, s.orders.orderNo),
    db.select().from(s.outlets),
  ]);
  const byId = new Map(outlets.map((o) => [o.id, o]));
  return {
    serviceDate,
    serviceDay: formatDay(serviceDate),
    cutoffClosed,
    orders: orders.map((o) => {
      const outlet = byId.get(o.outletId)!;
      return {
        ...o,
        outlet: {
          id: outlet.id,
          name: outlet.name,
          district: outlet.district,
          dockType: outlet.dockType,
          parkingConstraint: outlet.parkingConstraint,
          mallWindowOpen: outlet.mallWindowOpen,
          mallWindowClose: outlet.mallWindowClose,
          windowOpen: outlet.windowOpen,
          windowClose: outlet.windowClose,
        },
        fragile: o.brand === 'Tech',
      };
    }),
  };
}

export async function markNotificationsRead(user: AuthUser) {
  await db
    .update(s.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(s.notifications.outletId, user.outletId!), dsql`${s.notifications.readAt} is null`));
}
