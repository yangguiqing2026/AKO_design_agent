// AKO_studio - Design Agent v1.0.0
// 文件名: src/core/logger.ts
// 职责: 结构化 JSON 日志。无全局副作用、sink 可注入（便于测试与审计）。
// 用法: const log = createLogger({ scope: 'bootstrap' }); log.info('ok', { trace_id });
//       const child = log.child({ scope: 'cost-circuit', trace_id });

import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志级别数值序（越大越严重） */
export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** 附加结构化字段（禁止 any） */
export interface LogFields {
  readonly [key: string]: unknown;
}

/** 单条日志条目 */
export interface LogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly trace_id?: string;
  readonly data?: LogFields;
}

/** 日志接收器（可替换为文件/远端收集器） */
export type LogSink = (entry: Readonly<LogEntry>) => void;

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly scope?: string;
  readonly trace_id?: string;
  readonly sinks?: readonly LogSink[];
}

/** 生成可过滤 trace id：前缀固定便于 grep */
export function generateTraceId(): string {
  return `ako-dsg-${randomUUID()}`;
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return LOG_LEVELS.includes(value as LogLevel);
}

/** 错误对象归一化为可序列化字段 */
function normalizeData(data: unknown): LogFields {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  return data as LogFields;
}

/** 默认控制台 sink：JSON Lines 输出 */
export function createConsoleSink(): LogSink {
  return (entry: Readonly<LogEntry>): void => {
    let line: string;
    try {
      line = JSON.stringify({
        ts: entry.ts,
        level: entry.level,
        scope: entry.scope,
        trace_id: entry.trace_id,
        message: entry.message,
        ...(entry.data ? { data: entry.data } : {})
      });
    } catch {
      line = JSON.stringify({
        ts: entry.ts,
        level: entry.level,
        scope: entry.scope,
        message: entry.message,
        data: { serialization: 'failed' }
      });
    }
    const out = entry.level === 'warn' || entry.level === 'error' ? process.stderr : process.stdout;
    out.write(`${line}\n`);
  };
}

function resolveLevel(option: LogLevel | undefined): LogLevel {
  if (option !== undefined) {
    return option;
  }
  return isLogLevel(process.env.AKO_LOG_LEVEL) ? process.env.AKO_LOG_LEVEL : 'info';
}

export class Logger {
  private readonly options: LoggerOptions;
  private readonly sinkList: readonly LogSink[];

  constructor(options: LoggerOptions = {}) {
    this.options = {
      level: resolveLevel(options.level),
      scope: options.scope ?? 'app',
      trace_id: options.trace_id,
      sinks: options.sinks ?? [createConsoleSink()]
    };
    this.sinkList = this.options.sinks ?? [];
  }

  get level(): LogLevel {
    return this.options.level ?? 'info';
  }

  get scope(): string {
    return this.options.scope ?? 'app';
  }

  /** 是否允许该级别输出 */
  isEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[this.level];
  }

  child(options: { readonly scope?: string; readonly trace_id?: string }): Logger {
    return new Logger({
      level: this.options.level,
      scope: options.scope ?? this.options.scope,
      trace_id: options.trace_id ?? this.options.trace_id,
      sinks: this.sinkList
    });
  }

  /** 继承当前 trace 但切换 scope 的便捷方法 */
  withScope(scope: string): Logger {
    return this.child({ scope });
  }

  private emit(level: LogLevel, message: string, data?: unknown): void {
    if (!this.isEnabled(level)) {
      return;
    }
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      scope: this.options.scope ?? 'app',
      message,
      trace_id: this.options.trace_id,
      data: data === undefined ? undefined : normalizeData(data)
    };
    for (const sink of this.sinkList) {
      try {
        sink(entry);
      } catch {
        // sink 失败不中断调用方；由收集层保证可用性
      }
    }
  }

  debug(message: string, data?: unknown): void {
    this.emit('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.emit('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.emit('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.emit('error', message, data);
  }
}

/** 便捷工厂 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
