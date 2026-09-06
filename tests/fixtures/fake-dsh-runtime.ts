// AKO_studio - Design Agent v1.0.0
// 文件名: tests/fixtures/fake-dsh-runtime.ts
// 用途: 集成测试注入的假 DSH 运行时（实现防腐层最小契约，无需真实 @deepseek-ai/*）

import type {
  DshMessage,
  DshRuntime,
  DshRuntimeInfo,
  DshRuntimeSession,
  DshToolDefinition
} from '../../src/interfaces/dsh.interface';

export interface FakeDshRuntimeOptions {
  readonly name?: string;
  readonly version?: string;
  readonly apiVersion?: string;
  readonly failOpenSession?: boolean;
  readonly failSend?: boolean;
}

export class FakeDshRuntime implements DshRuntime {
  readonly info: DshRuntimeInfo;
  openCount = 0;
  abortCount = 0;
  closeCount = 0;
  receivedTools: (readonly DshToolDefinition[])[] = [];
  private readonly failOpenSession: boolean;
  private readonly failSend: boolean;
  private readonly echo: boolean;

  constructor(options: FakeDshRuntimeOptions = {}, echo = true) {
    this.info = {
      name: options.name ?? '@deepseek-ai/dsh-agent',
      version: options.version ?? '0.1.3-alpha.1',
      api_version: options.apiVersion ?? '0.1.3'
    };
    this.failOpenSession = options.failOpenSession ?? false;
    this.failSend = options.failSend ?? false;
    this.echo = echo;
  }

  async openSession(tools?: readonly DshToolDefinition[]): Promise<DshRuntimeSession> {
    this.openCount += 1;
    this.receivedTools.push(tools ?? []);
    if (this.failOpenSession) {
      throw new Error('fake runtime openSession failed');
    }
    const sessionId = `fake-session-${this.openCount}`;
    return {
      id: sessionId,
      send: async (messages: readonly DshMessage[]): Promise<readonly DshMessage[]> => {
        if (this.failSend) {
          throw new Error('fake runtime send failed');
        }
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        return [
          {
            role: 'assistant',
            content: this.echo
              ? `echo:${sessionId}:${lastUser?.content ?? ''}`
              : 'fake-assistant-reply'
          }
        ];
      },
      abort: async (): Promise<void> => {
        this.abortCount += 1;
      }
    };
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}
