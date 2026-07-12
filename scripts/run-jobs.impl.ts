import { fileURLToPath } from 'node:url';
import { runScheduledJobs } from '@telocc/core';
import { config } from 'dotenv';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const result = await runScheduledJobs();
console.log('scheduled jobs run:', result);
