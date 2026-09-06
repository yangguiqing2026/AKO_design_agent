// AKO_studio - Design Agent v1.0.1 (Sprint 3)
// 文件名: tests/unit/tool-bridge.test.ts
// 覆盖: ToolBridge 抽象语义——list/call/未知工具/参数校验/处理器异常、
//       权限分层（sandbox 直接执行，approval_required 需审批通道否则 blocked）、trace 透传。

import {
  bridgeEntry,
  LocalToolBridge,
  validateArguments
} from '../../src/modules/tool-bridge/tool-bridge';

function buildBridge(approver?: (name: string) => Promise<boolean> | boolean): LocalToolBridge {
  return new LocalToolBridge({
    approver,
    entries: [
      bridgeEntry(
        'alpha',
        '通用工具',
        { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        'general',
        (args, ctx) => ({ echoed: args.query, trace: ctx.trace_id })
      ),
      bridgeEntry(
        'sandboxy',
        '沙箱工具',
        { type: 'object', properties: { code: { type: 'string' } } },
        'sandbox',
        () => ({ ran: true })
      ),
      bridgeEntry(
        'dangerous',
        '高风险工具',
        { type: 'object', properties: { target: { type: 'string' } } },
        'approval_required',
        () => ({ executed: true })
      )
    ]
  });
}

describe('ToolBridge：list 与常规调用', () => {
  it('list 返回定义（含权限与 schema），名称可被 call', async () => {
    const bridge = buildBridge();
    const defs = bridge.list();
    expect(defs.map((d) => d.name).sort()).toEqual(['alpha', 'dangerous', 'sandboxy']);
    expect(defs.find((d) => d.name === 'sandboxy')?.permission).toBe('sandbox');
    const response = await bridge.call({ name: 'alpha', arguments: { query: 'hi' }, trace_id: 't1' });
    expect(response.status).toBe('ok');
    expect(response.output).toEqual({ echoed: 'hi', trace: 't1' });
  });

  it('未知工具 → not_found（类型化）', async () => {
    const bridge = buildBridge();
    const response = await bridge.call({ name: 'nope' });
    expect(response.status).toBe('not_found');
    expect(response.error?.code).toBe('TOOL_BRIDGE_NOT_FOUND');
  });

  it('缺必填/类型错误 → error TOOL_BRIDGE_INVALID_ARGUMENTS', async () => {
    const bridge = buildBridge();
    const missing = await bridge.call({ name: 'alpha', arguments: {} });
    expect(missing.status).toBe('error');
    expect(missing.error?.code).toBe('TOOL_BRIDGE_INVALID_ARGUMENTS');
    const wrongType = await bridge.call({ name: 'alpha', arguments: { query: 1 } });
    expect(wrongType.error?.code).toBe('TOOL_BRIDGE_INVALID_ARGUMENTS');
  });

  it('handler 抛错 → error TOOL_BRIDGE_HANDLER_FAILED（消息透出）', async () => {
    const bridge = new LocalToolBridge({
      entries: [
        bridgeEntry('boom', '抛错工具', {}, 'general', () => {
          throw new Error('handler exploded');
        })
      ]
    });
    const response = await bridge.call({ name: 'boom' });
    expect(response.status).toBe('error');
    expect(response.error?.code).toBe('TOOL_BRIDGE_HANDLER_FAILED');
    expect(response.error?.message).toContain('handler exploded');
  });
});

describe('ToolBridge：权限分层', () => {
  it('sandbox 工具直接执行（无需审批）', async () => {
    const bridge = buildBridge();
    const response = await bridge.call({ name: 'sandboxy', arguments: { code: 'ls' } });
    expect(response.status).toBe('ok');
  });

  it('approval_required 无审批通道 → blocked（不执行）', async () => {
    const bridge = buildBridge();
    const response = await bridge.call({ name: 'dangerous', arguments: { target: 'x' } });
    expect(response.status).toBe('blocked');
    expect(response.error?.code).toBe('TOOL_BRIDGE_BLOCKED');
  });

  it('approval_required 审批拒绝 → blocked；审批通过 → ok', async () => {
    const rejectBridge = buildBridge(async () => false);
    const rejected = await rejectBridge.call({ name: 'dangerous' });
    expect(rejected.status).toBe('blocked');

    const approveBridge = buildBridge(async (name) => name === 'dangerous');
    const approved = await approveBridge.call({ name: 'dangerous', arguments: { target: 'x' } });
    expect(approved.status).toBe('ok');
    expect(approved.output).toEqual({ executed: true });
  });
});

describe('validateArguments 单元', () => {
  it('声明类型校验 + required；未知属性忽略；非法 schema 宽松放行', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, tags: { type: 'array' }, ok: { type: 'boolean' } },
      required: ['name']
    };
    expect(validateArguments({ name: 'a' }, schema)).toEqual([]);
    expect(validateArguments({}, schema).join(';')).toContain('name');
    expect(validateArguments({ name: 1, tags: 'x' }, schema).join(';')).toContain('name');
    expect(validateArguments({ name: 'a', extra: 'ignored' }, schema)).toEqual([]);
    expect(validateArguments({ x: 1 }, 'not-schema' as never)).toEqual([]);
  });
});
