// AKO_studio - Design Agent v1.0.0
// 文件名: tests/unit/logger.test.ts
// 覆盖: generateTraceId / 级别过滤 / trace 传播 / Error 归一化 / 控制台 sink JSON

import {
  createConsoleSink,
  createLogger,
  generateTraceId,
  Logger,
  type LogEntry
} from '../../src/core/logger';

function collect(): { readonly entries: LogEntry[]; readonly sink: (e: LogEntry) => void } {
  const entries: LogEntry[] = [];
  return {
    entries,
    sink: (entry: LogEntry): void => {
      entries.push(entry);
    }
  };
}

describe('generateTraceId', () => {
  it('带固定前缀便于日志过滤', () => {
    expect(generateTraceId()).toMatch(/^ako-dsg-/);
  });

  it('连续生成不重复', () => {
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
  });
});

describe('Logger 级别过滤', () => {
  it('低于设定级别的事件不发出', () => {
    const collector = collect();
    const logger = createLogger({ level: 'warn', scope: 'test', sinks: [collector.sink] });
    logger.info('skip');
    logger.warn('keep');
    expect(collector.entries).toHaveLength(1);
    expect(collector.entries[0].level).toBe('warn');
  });

  it('isEnabled 依据级别排序', () => {
    const logger = new Logger({ level: 'info', scope: 'test', sinks: [] });
    expect(logger.isEnabled('info')).toBe(true);
    expect(logger.isEnabled('error')).toBe(true);
    expect(logger.isEnabled('debug')).toBe(false);
  });

  it('scope 与级别记录在条目上', () => {
    const collector = collect();
    const logger = createLogger({ level: 'debug', scope: 'unit', sinks: [collector.sink] });
    logger.debug('你好', { n: 1 });
    expect(collector.entries[0]).toMatchObject({ level: 'debug', scope: 'unit', message: '你好' });
    expect(typeof collector.entries[0].ts).toBe('string');
    expect(collector.entries[0].data).toEqual({ n: 1 });
  });
});

describe('Logger trace 传播', () => {
  it('child 继承父级 trace_id 并可覆盖 scope', () => {
    const collector = collect();
    const root = createLogger({ scope: 'root', trace_id: 't-123', sinks: [collector.sink] });
    const child = root.child({ scope: 'cost-circuit' });
    child.info('记账');
    expect(collector.entries[0]).toMatchObject({ scope: 'cost-circuit', trace_id: 't-123' });
  });

  it('withScope 便捷派生子日志', () => {
    const collector = collect();
    const root = createLogger({ trace_id: 't-1', sinks: [collector.sink] });
    root.withScope('sandbox').warn('越界');
    expect(collector.entries[0].scope).toBe('sandbox');
  });
});

describe('Logger 数据归一化', () => {
  it('Error 自动序列化为 name/message/stack', () => {
    const collector = collect();
    const logger = createLogger({ level: 'error', sinks: [collector.sink] });
    logger.error('boom', new Error('磁盘写失败'));
    const data = collector.entries[0].data;
    expect(data).toMatchObject({ name: 'Error', message: '磁盘写失败' });
    expect(typeof (data as { stack?: unknown }).stack).toBe('string');
  });
});

describe('createConsoleSink JSON 输出', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warn/error 走 stderr 且为合法 JSON Lines', () => {
    const writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger({
      level: 'info',
      scope: 'console',
      trace_id: 'tr-1',
      sinks: [createConsoleSink()]
    });
    logger.warn('warn-msg', { k: 'v' });
    expect(writeSpy).toHaveBeenCalled();
    const line = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: 'warn',
      scope: 'console',
      trace_id: 'tr-1',
      message: 'warn-msg'
    });
  });

  it('sink 抛错不中断调用方', () => {
    const logger = new Logger({ level: 'info', sinks: [() => { throw new Error('sink 挂了'); }] });
    expect(() => logger.info('still works')).not.toThrow();
  });
});
