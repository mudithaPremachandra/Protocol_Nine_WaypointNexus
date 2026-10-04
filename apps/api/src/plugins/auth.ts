import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@wn/domain';
import { config } from '../config';
import { db } from '../db/client';
import * as s from '../db/schema';
import type { AuthUser } from '../lib/events';
import { forbidden, HttpError } from '../lib/errors';

export const COOKIE = 'wn_token';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Short cache so every request doesn't hit the users table; roles never change at runtime. */
const userCache = new Map<string, { user: AuthUser; at: number }>();
export const invalidateUserCache = () => userCache.clear();

export async function loadUser(id: string): Promise<AuthUser | null> {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.user;
  const [row] = await db.select().from(s.users).where(eq(s.users.id, id));
  if (!row) return null;
  const user: AuthUser = {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role as Role,
    outletId: row.outletId,
    vehicleId: row.vehicleId,
    depot: row.depot,
  };
  userCache.set(id, { user, at: Date.now() });
  return user;
}

export default fp(async (app) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    cookie: { cookieName: COOKIE, signed: false },
    sign: { expiresIn: '7d' },
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    let payload: { sub: string };
    try {
      payload = await req.jwtVerify<{ sub: string }>({ onlyCookie: true });
    } catch {
      throw new HttpError(401, 'Please sign in');
    }
    const user = await loadUser(payload.sub);
    if (!user) throw new HttpError(401, 'Please sign in');
    req.user = user;
  });

  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (!roles.includes(req.user.role)) throw forbidden();
  });
});
