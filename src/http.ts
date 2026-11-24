import Fastify from 'fastify';
import type { Pool } from 'pg';
import { ZodError } from 'zod';

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createApp(pool: Pool, logger = false) {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024 });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({
      error: 'Invalid input',
      details: error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message }))
    });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    const issue = error as { code?: string; statusCode?: number };
    if (issue.code === '23505') return reply.code(409).send({ error: 'SKU already exists' });
    if (issue.statusCode && issue.statusCode < 500) return reply.code(issue.statusCode).send({ error: error instanceof Error ? error.message : 'Invalid request' });
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
  app.get('/api/health', async (_, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ error: 'Database unavailable' });
    }
  });
  return app;
}
