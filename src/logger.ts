import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

function emit(level: Level, bindings: Record<string, unknown>, msg: string, data?: Record<string, unknown>) {
  const cfg = config();
  if (ORDER[level] < ORDER[cfg.LOG_LEVEL]) return;
  const rec = { level, msg, ...bindings, ...data, t: new Date().toISOString() };
  if (cfg.LOG_FORMAT === 'json') { console.log(JSON.stringify(rec)); return; }
  const ctx = Object.entries({ ...bindings, ...data }).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  const tag = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' }[level];
  console.log(`${tag} ${msg}${ctx ? '  ' + ctx : ''}`);
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    child: (b) => createLogger({ ...bindings, ...b }),
    debug: (m, d) => emit('debug', bindings, m, d),
    info: (m, d) => emit('info', bindings, m, d),
    warn: (m, d) => emit('warn', bindings, m, d),
    error: (m, d) => emit('error', bindings, m, d),
  };
}

export const log = createLogger();
