"""Run identical work with/without batching and bounded concurrency."""
import argparse
import asyncio
import logging
import sys

from lab.env import load_env
from lab.local_service import ensure as ensure_local_service, stop as stop_local_service
from lab.teaching import Backend, answer_text, mixed_load, table


async def main():
    load_env()  # 自动读取 config/local.env，新终端不必先 source
    parser = argparse.ArgumentParser(description='合同RAG：批处理与并发前后对比')
    parser.add_argument('--fixture', action='store_true', help='确定性夹具，不代表模型或GPU性能')
    parser.add_argument('--concurrency', type=int, default=4)
    parser.add_argument('--batch-size', type=int, default=8)
    # 默认值按“远端推理模型单次生成 3–4 秒”校准；本地 GPU 服务可收紧到 2 / 12 / 30。
    parser.add_argument('--queue-timeout', type=float, default=30.)
    parser.add_argument('--request-timeout', type=float, default=90.)
    parser.add_argument('--deadline', type=float, default=400.)
    args = parser.parse_args()
    if args.concurrency < 2 or not 1 <= args.batch_size <= 8 or min(args.queue_timeout, args.request_timeout, args.deadline) <= 0:
        parser.error('concurrency至少2，batch-size为1～8，超时必须为正数')
    backend = Backend(args.fixture)
    service = None
    if not args.fixture:
        service = ensure_local_service(backend.embedding_base)
        backend.require_local_services()
    print('模式：'+('确定性夹具；固定延迟只用于验证调度，不代表模型或GPU性能' if args.fixture else '已配置的真实服务'))
    print('相同负载：40个后台片段＋4次在线合同对比；关闭应用缓存；等待上限32。')
    rows, results = [], []
    try:
        for label, concurrency, batch_size in [('逐条·串行', 1, 1), ('合批·串行', 1, args.batch_size),
                                                ('合批·并发', args.concurrency, args.batch_size)]:
            result = await mixed_load(backend, concurrency=concurrency, batch_size=batch_size,
                queue_timeout=args.queue_timeout, request_timeout=args.request_timeout, deadline_seconds=args.deadline)
            results.append(result)
            rows.append([label, batch_size, concurrency, result['elapsed_ms'], result['online_p95_ms'],
                         result['queue_p95_ms'], result['counts'].get('embedding_requests', 0),
                         result['peak'], result['peak_bg'], f"{result['online_ok']}/4",
                         f"{result['background_ok']}/40", len(result['errors'])])
        table(['方案', '批大小', '并发上限', '总耗时ms', '成功在线P95ms', '排队P95ms', '编码请求(总)',
               '实际并发峰值', '后台峰值', '在线完成', '后台完成', '失败'], rows)
        for label, result in zip(['逐条·串行', '合批·串行', '合批·并发'], results):
            if result['answers']:
                print(label+'结果：'+answer_text(result['answers'][0]))
            if result['errors']:
                print(label+'失败：'+','.join(result['errors']))
        print('全部查询通过数值与引用检查：'+('是' if all(r['all_results_valid'] for r in results) else '否'))
        print('全部调度额度已回收：'+('是' if all(r['slots_released'] for r in results) else '否'))
        if not all(r['all_results_valid'] and r['background_ok'] == r['background_total']
                   and r['slots_released'] for r in results):
            raise RuntimeError('存在未完成或未通过验收的任务')
    finally:
        await backend.close()
        stop_local_service(service)


if __name__ == '__main__':
    logging.disable(logging.WARNING)
    try:
        asyncio.run(main())
    except (Exception, KeyboardInterrupt) as error:
        print('执行未完成：'+str(error), file=sys.stderr)
        sys.exit(1)
