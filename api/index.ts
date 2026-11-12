import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { readConfig } from '../src/server/config.js';
import { buildApp } from '../src/server/app.js';

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = readConfig();
      const app = await buildApp({
        config,
        serveStatic: false,
        logger: false,
      });
      await app.ready();
      return app;
    })().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export async function closeAppForTesting(): Promise<void> {
  if (appPromise) {
    const app = await appPromise;
    appPromise = null;
    await app.close();
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const app = await getApp();
    if (res.writableEnded) return;
    await new Promise<void>((resolve, reject) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      res.on('error', reject);
      app.server.emit('request', req, res);
    });
  } catch (error) {
    console.error('Fastify serverless invocation error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal Server Error',
          },
        }),
      );
    }
  }
}
