// AKO_studio - Design Agent v1.0.1 (Sprint 3 +)
// 文件名: tests/integration/api-server.test.ts
// 覆盖: --serve 模式 HTTP API——/health、/design/chat（SSE 流式进度 + result + done）、
//       非法入参 400、CLI 解析（--serve / --host 默认与显式 / PORT）。

import { buildApiServer, parseCliArgs, DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT } from '../../src/bootstrap';
import { createDesignContext } from '../../src/interfaces/design-context.interface';
import type { DesignContext } from '../../src/interfaces/design-context.interface';
import type { DesignSessionResult, DesignSessionOptions } from '../../src/interfaces/session.interface';
import type { SessionOrchestrator } from '../../src/core/session-orchestrator';

let capturedOptions: DesignSessionOptions | undefined;

function makeStubOrchestrator(): Pick<SessionOrchestrator, 'runDesignSession'> {
  return {
    runDesignSession: async (prompt: string, options?: DesignSessionOptions): Promise<DesignSessionResult> => {
      capturedOptions = options;
      options?.on_event?.({
        kind: 'step',
        session_id: 'http-session',
        trace_id: 'http-trace',
        status: 'analyzing',
        detail: 'HTTP 会话开始'
      });
      const ctx: DesignContext = {
        ...createDesignContext({ session_id: 'http-session', user_prompt: prompt }),
        status: 'completed',
        checkpoint: 'delivered',
        retry_count: 0,
        generated_profile: {
          name: 'http-agent',
          bundles: ['@deepseek-ai/dsh-base'],
          patches: [{ id: 'loop', config: { loop: 'default' } }]
        }
      };
      return {
        session_id: 'http-session',
        trace_id: ctx.trace_id,
        status: 'completed',
        outcome: 'delivered',
        ctx,
        steps_used: 3,
        resumed: false
      };
    }
  };
}

describe('buildApiServer', () => {
  it('GET /health 返回 status/version/overall', async () => {
    const app = buildApiServer({
      orchestrator: makeStubOrchestrator(),
      version: '9.9.9-test',
      overall: 'ok'
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; version: string; overall: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('9.9.9-test');
    expect(body.overall).toBe('ok');
    await app.close();
  });

  it('POST /design/chat：SSE 输出 progress → result → done，透传 session_id/max_steps', async () => {
    const app = buildApiServer({
      orchestrator: makeStubOrchestrator(),
      version: '1.0.0',
      overall: 'ok'
    });
    const response = await app.inject({
      method: 'POST',
      url: '/design/chat',
      payload: JSON.stringify({ prompt: '设计一个 Agent', session_id: 'abc-1', max_steps: 12 }),
      headers: { 'content-type': 'application/json' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const payload = response.body;
    expect(payload).toContain('event: progress');
    expect(payload).toContain('event: result');
    expect(payload).toContain('"outcome":"delivered"');
    expect(payload).toContain('"session_id":"http-session"');
    expect(payload).toContain('event: done');
    expect(capturedOptions?.session_id).toBe('abc-1');
    expect(capturedOptions?.max_steps).toBe(12);
    await app.close();
  });

  it('POST /design/chat 缺 prompt → 400 BAD_REQUEST', async () => {
    const app = buildApiServer({
      orchestrator: makeStubOrchestrator(),
      version: '1.0.0',
      overall: 'ok'
    });
    const response = await app.inject({
      method: 'POST',
      url: '/design/chat',
      payload: JSON.stringify({}),
      headers: { 'content-type': 'application/json' }
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
    await app.close();
  });
});

describe('parseCliArgs（--serve 模式）', () => {
  it('无参数：非 serve，host=127.0.0.1，port=3080（显式无 PORT env）', () => {
    const cli = parseCliArgs([], '');
    expect(cli.serve).toBe(false);
    expect(cli.host).toBe(DEFAULT_SERVE_HOST);
    expect(cli.port).toBe(DEFAULT_SERVE_PORT);
  });

  it('--serve 启用；--host 0.0.0.0 显式监听所有网卡', () => {
    expect(parseCliArgs(['--serve']).serve).toBe(true);
    expect(parseCliArgs(['--serve', '--host', '0.0.0.0']).host).toBe('0.0.0.0');
    expect(parseCliArgs(['--host', '127.0.0.2']).host).toBe('127.0.0.2');
  });

  it('--host 不带值等价 0.0.0.0（模板语义）；PORT env 覆盖默认端口', () => {
    expect(parseCliArgs(['--host']).host).toBe('0.0.0.0');
    expect(parseCliArgs(['--serve'], '4100').port).toBe(4100);
    expect(parseCliArgs(['--serve'], 'not-a-port').port).toBe(DEFAULT_SERVE_PORT);
    expect(parseCliArgs(['--serve'], '0').port).toBe(DEFAULT_SERVE_PORT);
  });
});
