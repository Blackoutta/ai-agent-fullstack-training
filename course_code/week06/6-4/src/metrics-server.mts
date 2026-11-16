/**
 * 业务后端的指标导出端点。
 *
 * 与 Pi 会话端点（pi-prometheus 扩展暴露）相互独立：
 * - Pi 会话端点回答「Agent 跑了什么」，端口由扩展分配并写到 ~/.pi/metrics/targets/
 * - 本端点回答「业务办成了什么」和「工具选对了吗」，端口固定为 9464
 *
 * 业务层与 Agent 层指标统一从这里暴露，因此 Prometheus 只需一个
 * order-backend 采集任务，就能同时拿到 order_query_* 和 agent_* 两组指标。
 */
import { createServer, type Server } from "node:http";
import { backendRegistry } from "./registry.mts";

export const METRICS_PORT = Number(process.env.BACKEND_METRICS_PORT ?? 9464);

export function startMetricsServer(port = METRICS_PORT): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.url?.split("?")[0] !== "/metrics") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found\n");
      return;
    }
    try {
      const body = await backendRegistry.metrics();
      res.writeHead(200, {
        "content-type": backendRegistry.contentType,
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`metric collection failed: ${String(error)}\n`);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export function stopMetricsServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
