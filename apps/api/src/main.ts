import 'reflect-metadata';
import { createApp } from './app.factory.js';
import { loadApiEnv } from './config/env.js';

const env = loadApiEnv();
const app = await createApp(env);
await app.listen(env.API_PORT, '0.0.0.0');
