import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SyncPushBody } from '@wn/domain';
import { config } from './config';
import { db } from './db/client';
import * as s from './db/schema';
import { seedDemoDay } from './db/seed/demoDay';
import { getState } from './lib/appState';
import { formatDay } from './lib/dates';
import { badRequest, forbidden, notFound } from './lib/errors';
import { emit, onEvent, visibleTo } from './lib/events';
import { COOKIE, invalidateUserCache } from './plugins/auth';
import { driverSnapshot, loaderQueue, storeView, tripForLoader } from './services/field';
import { approveRecovery, incidentView, listIncidents } from './services/incidents';
import { liveBoard, resolveFlag } from './services/live';
import { markNotificationsRead, orderQueue, PlaceOrderBody, placeOrder, productsFor } from './services/orders';
import { capacityOutlook } from './services/outlook';
import {
  applySwap,
  approveDeferrals,
  closeOrders,
  deferOrder,
  generatePlan,
  moveOrder,
  planView,
  publishPlan,
  tripCheck,
} from './services/planning';
import { applyMutations } from './services/sync';

const Id = z.object({ id: z.string().uuid() });

export async function routes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const dispatcher = { preHandler: app.requireRole('dispatcher') };
  const anyUser = { preHandler: app.authenticate };

  /* ------------------------------ meta ------------------------------ */

  app.get('/api/health', async () => ({ ok: true, at: new Date().toISOString() }));

  app.get('/api/state', anyUser, async () => {
    const st = await getState(db);
    const [plan] = await db.select().from(s.plans).where(eq(s.plans.date, st.serviceDate));
    return { ...st, serviceDay: formatDay(st.serviceDate), planVersion: plan?.version ?? 0, planStatus: plan?.status ?? null, demoControls: config.DEMO_CONTROLS };
  });

  /* ------------------------------ auth ------------------------------ */

  app.post('/api/auth/login', { schema: { body: z.object({ username: z.string().min(1), password: z.string().min(1) }) } }, async (req, reply) => {
    const [user] = await db.select().from(s.users).where(eq(s.users.username, req.body.username.trim().toLowerCase()));
    if (!user || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Wrong username or password' });
    }
    const token = await reply.jwtSign({ sub: user.id });
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 7 * 24 * 3600,
    });
    return { id: user.id, username: user.username, name: user.name, role: user.role, outletId: user.outletId, vehicleId: user.vehicleId, depot: user.depot };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', anyUser, async (req) => {
    const u = req.user;
    const [outlet] = u.outletId ? await db.select({ name: s.outlets.name, brand: s.outlets.brand }).from(s.outlets).where(eq(s.outlets.id, u.outletId)) : [];
    return { ...u, outletName: outlet?.name ?? null, outletBrand: outlet?.brand ?? null };
  });

  /* --------------------------- store manager -------------------------- */

  const store = { preHandler: app.requireRole('store_manager') };
  app.get('/api/store/products', store, async (req) => productsFor(req.user));
  app.get('/api/store/view', store, async (req) => storeView(req.user));
  app.post('/api/store/orders', { ...store, schema: { body: PlaceOrderBody } }, async (req) => placeOrder(req.user, req.body));
  app.post('/api/store/notifications/read', store, async (req) => {
    await markNotificationsRead(req.user);
    return { ok: true };
  });

  /* ----------------------------- dispatcher ---------------------------- */

  app.get('/api/dispatch/queue', dispatcher, async () => orderQueue());
  app.post('/api/dispatch/close-orders', dispatcher, async (req) => closeOrders(req.user));
  app.post('/api/dispatch/plan', dispatcher, async (req) => generatePlan(req.user));
  app.get('/api/dispatch/plan', dispatcher, async () => planView());
  app.get('/api/dispatch/trips/:id', { ...dispatcher, schema: { params: Id } }, async (req) => tripCheck(req.params.id));
  app.post(
    '/api/dispatch/move',
    { ...dispatcher, schema: { body: z.object({ orderId: z.string().uuid(), vehicleId: z.string(), tripNo: z.number().int().min(1).max(2).optional(), apply: z.boolean().default(false) }) } },
    async (req) => moveOrder(req.user, req.body),
  );
  app.post(
    '/api/dispatch/defer',
    { ...dispatcher, schema: { body: z.object({ orderId: z.string().uuid(), note: z.string().max(300).nullish() }) } },
    async (req) => deferOrder(req.user, req.body.orderId, req.body.note ?? null),
  );
  app.post(
    '/api/dispatch/swap',
    { ...dispatcher, schema: { body: z.object({ orderId: z.string().uuid(), victimOrderId: z.string().uuid() }) } },
    async (req) => applySwap(req.user, req.body.orderId, req.body.victimOrderId),
  );
  app.post('/api/dispatch/deferrals/approve', dispatcher, async (req) => approveDeferrals(req.user));
  app.post('/api/dispatch/publish', dispatcher, async (req) => publishPlan(req.user));
  app.get('/api/dispatch/live', dispatcher, async () => liveBoard());
  app.post('/api/dispatch/flags/:id/resolve', { ...dispatcher, schema: { params: Id } }, async (req) => {
    await resolveFlag(req.params.id, req.user.id);
    return { ok: true };
  });
  app.get('/api/dispatch/incidents', dispatcher, async () => listIncidents());
  app.get('/api/dispatch/incidents/:id', { ...dispatcher, schema: { params: Id } }, async (req) => incidentView(req.params.id));
  app.post(
    '/api/dispatch/incidents/:id/approve',
    { ...dispatcher, schema: { params: Id, body: z.object({ option: z.string() }) } },
    async (req) => approveRecovery(req.user, req.params.id, req.body.option),
  );
  app.get('/api/dispatch/outlook', dispatcher, async () => capacityOutlook());

  /* ---------------------------- loader / driver --------------------------- */

  app.get(
    '/api/loader/queue',
    { preHandler: app.requireRole('loader'), schema: { querystring: z.object({ depot: z.enum(['Peliyagoda', 'Kandy']).optional() }) } },
    async (req) => loaderQueue(req.user, req.query.depot),
  );
  app.get('/api/loader/trips/:id', { preHandler: app.requireRole('loader'), schema: { params: Id } }, async (req) => tripForLoader(req.params.id));

  app.get(
    '/api/driver/today',
    { preHandler: app.requireRole('driver'), schema: { querystring: z.object({ vehicle: z.string().optional() }) } },
    async (req) => {
      // Demo convenience: drive another vehicle (only when demo controls are on).
      const override = config.DEMO_CONTROLS ? req.query.vehicle : undefined;
      return driverSnapshot(req.user, override);
    },
  );

  // Phone GPS during trips, uploaded in batches (queued on the phone while offline; device UUIDs make retries safe).
  app.post(
    '/api/driver/positions',
    {
      preHandler: app.requireRole('driver'),
      schema: {
        body: z.object({
          vehicleId: z.string().optional(),
          points: z
            .array(z.object({ id: z.string().uuid(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).nullish(), at: z.string().datetime({ offset: true }) }))
            .max(500),
        }),
      },
    },
    async (req) => {
      const vehicleId = (config.DEMO_CONTROLS ? req.body.vehicleId : undefined) ?? req.user.vehicleId;
      if (!vehicleId) throw badRequest('No vehicle assigned to this driver');
      if (req.body.points.length) {
        await db
          .insert(s.vehiclePositions)
          .values(req.body.points.map((p) => ({ id: p.id, vehicleId, driverId: req.user.id, lat: p.lat, lng: p.lng, accuracyM: p.accuracy ?? null, deviceTime: new Date(p.at) })))
          .onConflictDoNothing();
      }
      return { accepted: req.body.points.length };
    },
  );

  /* -------------------------------- sync -------------------------------- */

  app.post(
    '/api/sync/push',
    { preHandler: app.authenticate, schema: { body: SyncPushBody.extend({ pending: z.number().int().min(0).optional() }) } },
    async (req) => ({ results: await applyMutations(req.user, req.body.mutations, req.body.pending ?? 0), serverTime: new Date().toISOString() }),
  );

  /* -------------------------------- photos ------------------------------- */

  const uploadDir = resolve(config.UPLOAD_DIR);
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  app.post('/api/photos', anyUser, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('No photo attached');
    const id = String((file.fields.id as { value?: string } | undefined)?.value ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Photo id must be a UUID generated on the device');
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) throw badRequest('Photos must be JPEG, PNG or WebP');
    const [existing] = await db.select().from(s.photos).where(eq(s.photos.id, id));
    if (existing) return { id, duplicate: true };
    const buf = await file.toBuffer();
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const ext = file.mimetype.split('/')[1];
    const path = join(uploadDir, `${id}.${ext}`);
    await writeFile(path, buf);
    await db.insert(s.photos).values({ id, path, mime: file.mimetype, size: buf.length, sha256, uploadedBy: req.user.id }).onConflictDoNothing();
    return reply.code(201).send({ id });
  });

  app.get('/api/photos/:id', { ...anyUser, schema: { params: Id } }, async (req, reply) => {
    const [photo] = await db.select().from(s.photos).where(eq(s.photos.id, req.params.id));
    if (!photo || !existsSync(photo.path)) throw notFound('Photo');
    reply.header('cache-control', 'private, max-age=86400, immutable');
    return reply.type(photo.mime).send(createReadStream(photo.path));
  });

  /* ------------------------------ live events ----------------------------- */

  app.get('/api/events/stream', anyUser, async (req, reply) => {
    const user = req.user;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`retry: 3000\n\n`);
    const off = onEvent((row) => {
      if (!visibleTo(user, row.scope as never)) return;
      reply.raw.write(`id: ${row.id}\nevent: change\ndata: ${JSON.stringify({ id: row.id, type: row.type, at: row.at, actorName: row.actorName, planVersion: row.planVersion, payload: row.payload })}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      off();
    });
    return reply.hijack();
  });

  /* ------------------------------ demo controls ---------------------------- */

  app.post('/api/admin/reset', dispatcher, async (req) => {
    if (!config.DEMO_CONTROLS) throw forbidden('Demo controls are disabled');
    await seedDemoDay(db, config.DEMO_DATE, (m) => req.log.info(m));
    invalidateUserCache();
    await emit(db, { type: 'demo.reset', actor: req.user, scope: { all: true }, payload: { message: 'Demo day reset to its starting state' } });
    return { ok: true };
  });
}
