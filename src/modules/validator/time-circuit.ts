// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: src/modules/validator/time-circuit.ts
// 职责: 时间熔断（Sprint 3 P1，白皮书 §10.1「时间熔断可靠性：TTFT 超阈值降级/中断」）。
//   - 会话墙钟：begin(sessionId)/checkSession()，超过 max_session_ms 抛 TimeBreachError
//   - TTFT 上限：assertLatencyMs(label, ms) 校验一次调用首字/轮次时延 ≤ max_ttft_ms
//   - 时钟可注入（单测 fake clock 实现 100% 熔断语义；生产用 Date.now）
//   - 语义：超限即中断/降级（复用检查点可 resume），错误类型化 code=TIME_BREACHED

/** 时间熔断错误 */
export class TimeBreachError extends Error {
  readonly code = 'TIME_BREACHED';
  readonly kind: 'session_timeout' | 'ttft_timeout';

  constructor(kind: TimeBreachError['kind'], message: string) {
    super(message);
    this.name = 'TimeBreachError';
    this.kind = kind;
  }
}

export const DEFAULT_SESSION_TIMEOUT_MS = 60_000;
export const DEFAULT_TTFT_TIMEOUT_MS = 30_000;

export interface TimeCircuitOptions {
  /** 会话墙钟上限（毫秒；缺省 60s，与 default.yml runtime.timeout 语义对齐） */
  readonly maxSessionMs?: number;
  /** 单次调用时延/TTFT 上限（毫秒；缺省 30s） */
  readonly maxTtftMs?: number;
  /** 时间源（毫秒时间戳；缺省 Date.now） */
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

/** 时间熔断实现 */
export class TimeCircuit {
  private readonly maxSessionMs: number;
  private readonly maxTtftMs: number;
  private readonly nowProvider: () => number;
  private readonly warnSink: (message: string) => void;
  /** 墙钟起点（-1 = 未 begin，避免与真实 0 时间戳冲突） */
  private startedAt = -1;
  private sessionId: string | undefined;

  constructor(options: TimeCircuitOptions = {}) {
    this.maxSessionMs = options.maxSessionMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.maxTtftMs = options.maxTtftMs ?? DEFAULT_TTFT_TIMEOUT_MS;
    this.nowProvider = options.now ?? ((): number => Date.now());
    this.warnSink = options.warn ?? ((): void => undefined);
  }

  /** 开始（或重置）会话墙钟 */
  begin(sessionId: string): void {
    this.sessionId = sessionId;
    this.startedAt = this.nowProvider();
  }

  /** 会话墙钟检查：超限抛 TimeBreachError（kind=session_timeout） */
  checkSession(): void {
    if (this.startedAt < 0) {
      return; // 未 begin 不阻断（缺省宽松）
    }
    const elapsed = this.elapsedMs();
    if (elapsed > this.maxSessionMs) {
      const message = `会话超时：elapsed=${elapsed}ms > max=${this.maxSessionMs}ms（session=${this.sessionId ?? '-'}）`;
      this.warnSink(message);
      throw new TimeBreachError('session_timeout', message);
    }
  }

  /** 单次调用时延/TTFT 上限检查 */
  assertLatencyMs(label: string, latencyMs: number): void {
    if (latencyMs > this.maxTtftMs) {
      const message = `${label} 时延超阈值：latency=${latencyMs}ms > max=${this.maxTtftMs}ms`;
      this.warnSink(message);
      throw new TimeBreachError('ttft_timeout', message);
    }
  }

  /** 会话已流逝毫秒（未 begin 返回 0） */
  elapsedMs(): number {
    if (this.startedAt < 0) {
      return 0;
    }
    return Math.max(0, this.nowProvider() - this.startedAt);
  }

  /** 配置快照（审计/日志） */
  snapshot(): { readonly max_session_ms: number; readonly max_ttft_ms: number; readonly session_id?: string; readonly elapsed_ms: number } {
    return {
      max_session_ms: this.maxSessionMs,
      max_ttft_ms: this.maxTtftMs,
      ...(this.sessionId !== undefined ? { session_id: this.sessionId } : {}),
      elapsed_ms: this.elapsedMs()
    };
  }
}
