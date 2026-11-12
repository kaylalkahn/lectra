import path from 'node:path';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(process.env.DATA_DIR || './data');
const app = createApp({
  dataDir,
  secureCookies: process.env.COOKIE_SECURE === '1',
  maxLectureBytes: (Number(process.env.MAX_LECTURE_MB) || 4096) * 1024 * 1024,
});
const server = app.listen(port, () => console.log(`Lectra running at http://localhost:${port}  (data: ${dataDir})`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { app.locals.db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
}
