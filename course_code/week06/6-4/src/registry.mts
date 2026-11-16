/**
 * 后端共享的指标 Registry。
 *
 * 业务层（order_query_*）和 Agent 层（agent_*）都注册到同一个 Registry，
 * 由同一个 /metrics 端点输出。
 *
 * 不分别建两个 Registry 再拼接文本：拼接会在交界处留下空行，
 * OpenMetrics 解析器遇到空行或结尾不规范会整体报错，
 * 导致 Prometheus 报 "expected a valid start token" 并丢掉全部指标。
 */
import { Registry, collectDefaultMetrics } from "prom-client";

export const backendRegistry = new Registry();

// 进程与事件循环等运行时指标，便于确认导出端点本身健康。
collectDefaultMetrics({ register: backendRegistry, prefix: "order_query_backend_" });
