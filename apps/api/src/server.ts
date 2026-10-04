import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { config } from './config';
import { sql } from './db/client';
import { migrateAndSeed } from './db/seed/run';
import { HttpError } from './lib/errors';
import auth from './plugins/auth';
import { routes } from './routes';

export async function buildServer() {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'production' ? 'info' : 'debug', transport: undefined },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    if (err instanceof ZodError || (err as { validation?: unknown }).validation) {
      return reply.code(400).send({ error: 'Invalid request', details: (err as { validation?: unknown }).validation ?? (err as ZodError).issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server' });
  });

  await app.register(auth);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(routes);

  // The built SPA is served from the same origin, so cookies and the service worker scope are simple.
  const webDist = resolve(config.WEB_DIST);
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: false });
    const sendIndex = (reply: import('fastify').FastifyReply) => reply.header('cache-control', 'no-cache').sendFile('index.html');
    app.get('/', (_req, reply) => sendIndex(reply));
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      const path = req.url.split('?')[0]!;
      // Real files (assets, sw.js, manifest) are served directly; everything else is a client route.
      if (/\.[a-z0-9]+$/i.test(path)) return reply.sendFile(path.slice(1), { cacheControl: !path.endsWith('sw.js') });
      return sendIndex(reply);
    });
  }
  return app;
}

async function main() {
  if (config.SEED_ON_START) await migrateAndSeed();
  const app = await buildServer();
  const close = async () => {
    await app.close();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
