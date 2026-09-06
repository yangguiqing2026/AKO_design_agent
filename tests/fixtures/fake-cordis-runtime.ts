// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/fixtures/fake-cordis-runtime.ts
// 用途: 集成测试注入的假 Cordis-4 运行时（实现归一化契约，无真实 @deepseek-ai/*）。
//   - 依据 CORDIS_INFERRED_SHAPE：ctx.agents.create/register + Agent handle(send/followup/steer/abort)
//   - 支持故障注入（create 失败 / send 失败 / 固定时延）与调用记录

import type {
  CordisAgentDefinition,
  CordisAgentHandle,
  CordisAgentRuntimeLike,
  CordisAgentTurn,
  CordisToolDefinition
} from '../../src/interfaces/cordis-agent.interface';

export interface FakeCordisAgentOptions {
  readonly name?: string;
  readonly version?: string;
  readonly apiVersion?: string;
  readonly failCreate?: boolean;
  readonly failSend?: boolean;
  readonly latencyMs?: number;
}

export class FakeCordisAgentHandle implements CordisAgentHandle {
  readonly id: string;
  sends = 0;
  followups = 0;
  steers = 0;
  aborted = false;
  lastTools: readonly CordisToolDefinition[] = [];

  constructor(
    readonly def: CordisAgentDefinition,
    private readonly options: Required<
      Pick<FakeCordisAgentOptions, 'failSend' | 'latencyMs'>
    >
  ) {
    this.id = def.id;
  }

  private turn(content: string): CordisAgentTurn {
    return {
      content,
      ...(this.options.latencyMs > 0 ? { latency_ms: this.options.latencyMs } : {})
    };
  }

  async send(input: { readonly text: string }): Promise<CordisAgentTurn> {
    this.sends += 1;
    this.lastTools = this.def.tools ?? [];
    if (this.options.failSend) {
      throw new Error('fake cordis send failed');
    }
    return this.turn(`echo:${input.text}`);
  }

  async followup(prompt: string): Promise<CordisAgentTurn> {
    this.followups += 1;
    if (this.options.failSend) {
      throw new Error('fake cordis followup failed');
    }
    return this.turn(`echo-followup:${prompt}`);
  }

  async steer(directive: string): Promise<CordisAgentTurn> {
    this.steers += 1;
    if (this.options.failSend) {
      throw new Error('fake cordis steer failed');
    }
    return this.turn(`echo-steer:${directive}`);
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }
}

/** 假 Cordis-4 运行时（实现 CordisAgentRuntimeLike） */
export class FakeCordisRuntime implements CordisAgentRuntimeLike {
  readonly name: string;
  readonly version: string;
  readonly api_version: string;
  readonly agents: {
    create(definition: CordisAgentDefinition): Promise<CordisAgentHandle>;
    register(definition: CordisAgentDefinition): Promise<CordisAgentHandle>;
    list(): readonly CordisAgentDefinition[];
  };
  created: FakeCordisAgentHandle[] = [];
  createCalls = 0;
  registerCalls = 0;
  private readonly failCreate: boolean;
  private readonly failSend: boolean;
  private readonly latencyMs: number;

  constructor(options: FakeCordisAgentOptions = {}) {
    this.name = options.name ?? '@deepseek-ai/dsh-agent';
    this.version = options.version ?? '0.1.3-alpha.1';
    this.api_version = options.apiVersion ?? '0.1.3';
    this.failCreate = options.failCreate ?? false;
    this.failSend = options.failSend ?? false;
    this.latencyMs = options.latencyMs ?? 0;
    this.agents = {
      create: async (definition): Promise<CordisAgentHandle> => {
        this.createCalls += 1;
        if (this.failCreate) {
          throw new Error('fake cordis createAgent failed');
        }
        const handle = new FakeCordisAgentHandle(
          definition,
          { failSend: this.failSend, latencyMs: this.latencyMs }
        );
        this.created.push(handle);
        return handle;
      },
      register: async (definition): Promise<CordisAgentHandle> => {
        this.registerCalls += 1;
        if (this.failCreate) {
          throw new Error('fake cordis register failed');
        }
        const handle = new FakeCordisAgentHandle(
          definition,
          { failSend: this.failSend, latencyMs: this.latencyMs }
        );
        this.created.push(handle);
        return handle;
      },
      list: (): readonly CordisAgentDefinition[] => this.created.map((h) => h.def)
    };
  }

  lastCreated(): FakeCordisAgentHandle | undefined {
    return this.created[this.created.length - 1];
  }
}
