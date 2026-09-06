# TTFT / 时间熔断 真机验证清单（Sprint 3 P1）

> 目标：白皮书 §10.1「时间熔断可靠性：100% TTFT 超阈值时降级/中断」。
> 代码层已交付 `src/modules/validator/time-circuit.ts`（会话墙钟 + TTFT 上限，可注入时钟，
> 100% 熔断语义由 `tests/unit/time-circuit.test.ts` 覆盖）；真机跑分需受控网络/凭据环境，
> 本清单供具备环境时人工执行并把结果回填 `.ako-compliance-report.md`。

## 前提

- 有可用的 LLM/流式端点（stream=true）与网络出口；暴露为环境变量 `TTFT_TEST_ENDPOINT`。
- 触发 live 测试：`AKO_TTFT_LIVE=1`、`TTFT_THRESHOLD_MS=<阈值ms>`。

## 自动化探针

```bash
npx jest tests/integration/ttft-live-probe.test.ts --ci
# 默认：跳过（CI 常态）。设置 AKO_TTFT_LIVE=1 + TTFT_TEST_ENDPOINT 后执行真机断言
```

## 手工采样（curl 测首字时延）

```bash
# 记录 request 开始时间并测量首个 chunk 到达（stream）
curl -N -w "\nttft_ms=%{time_starttransfer}\n" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{"model":"<真实模型>","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  "$TTFT_TEST_ENDPOINT" -o /dev/null
```

采样 10 次：P50/P95/P100 与阈值比较；任一超过 `config/default.yml llm.ttft_timeout_ms`
即应触发 `TimeBreachError(kind=ttft_timeout)` → 会话降级/中断（复用检查点可 resume）。

## 回填模板（执行后写入 .ako-compliance-report.md）

| 项 | 值 |
|---|---|
| 环境（endpoint 说明/网络） | |
| 采样数 | 10 |
| P50 / P95 / P100（ms） | |
| 阈值（ms） | 30000 |
| 超限触发中断次数 | |
| 结论 | 通过 / 不通过（附失败原因） |
