import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../src/server/vercel/handler.js';
export default function handler(req:IncomingMessage,res:ServerResponse) {
  return handle(req,res);
}
