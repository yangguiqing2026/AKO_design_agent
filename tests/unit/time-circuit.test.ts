// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/unit/time-circuit.test.ts
// 覆盖: 时间熔断——会话墙钟 100% 阈值语义（未超/临界/超限）、TTFT 上限、可注入时钟、快照。

import { TimeBreachError, TimeCircuit } from '../../src/modules/validator/time-circuit';

describe('TimeCircuit：会话墙钟', () => {
  it('未超限不抛错；达到上限即抛 session_timeout（100% 语义）', () => {
    let now = 0;
    const circuit = new TimeCircuit({ maxSessionMs: 100, now: () => now });
    circuit.begin('s1');
    now = 50;
    expect(() => circuit.checkSession()).not.toThrow();
    now = 100; // 临界：>100 才熔断
    expect(() => circuit.checkSession()).not.toThrow();
    now = 101;
    expect(() => circuit.checkSession()).toThrow(TimeBreachError);
    try {
      circuit.checkSession();
    } catch (err) {
      const typed = err as TimeBreachError;
      expect(typed.code).toBe('TIME_BREACHED');
      expect(typed.kind).toBe('session_timeout');
    }
  });

  it('未 begin 时 check 宽松放行；elapsed=0', () => {
    const circuit = new TimeCircuit({ maxSessionMs: 1, now: () => 999 });
    expect(circuit.elapsedMs()).toBe(0);
    expect(() => circuit.checkSession()).not.toThrow();
  });

  it('assertLatencyMs 超 ttft 上限抛 ttft_timeout；snapshot 携带配置', () => {
    let now = 0;
    const circuit = new TimeCircuit({ maxTtftMs: 50, maxSessionMs: 1000, now: () => now });
    circuit.begin('s2');
    expect(() => circuit.assertLatencyMs('evaluate', 40)).not.toThrow();
    expect(() => circuit.assertLatencyMs('llm-turn', 51)).toThrow(TimeBreachError);
    try {
      circuit.assertLatencyMs('llm-turn', 51);
    } catch (err) {
      expect((err as TimeBreachError).kind).toBe('ttft_timeout');
    }
    const snap = circuit.snapshot();
    expect(snap.max_session_ms).toBe(1000);
    expect(snap.max_ttft_ms).toBe(50);
    expect(snap.session_id).toBe('s2');
    expect(snap.elapsed_ms).toBe(0);
  });
});
