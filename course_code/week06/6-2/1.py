"""Run: python 1-1.py [--cache all|semantic|embedding|prompt|rag|tool|ingestion] [--repeat 3]."""
import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

from lab.env import load_env
from lab.local_service import ensure as ensure_local_service, stop as stop_local_service
from lab.teaching import (Backend, answer_text, cache_comparison, ingestion_comparison,
                          prompt_comparison, table)

# 计数是确定性的：命中时必须归零，这是判断缓存是否真生效的主依据。
COUNTERS = [('embedding_requests', '编码'), ('retrieval_requests', '召回'),
            ('rerank_requests', '重排'), ('body_reads', '正文'), ('generation_requests', '生成')]


def diff_text(row, base):
    parts = [f"{row['counts'].get(key, 0)-base['counts'].get(key, 0):+d} {label}"
             for key, label in COUNTERS if row['counts'].get(key, 0) != base['counts'].get(key, 0)]
    return '，'.join(parts) if parts else '无'


def bar(ms, peak, width=18):
    return '█'*max(1, round(width*ms/peak)) if peak and ms else '·'


def span(value, limits):
    # 单次采样没有极差可讲，只显示中位数。
    return f'{value}' if limits[0] == limits[1] else f'{value}[{limits[0]}–{limits[1]}]'


SHORT = {'关闭': '关闭', '开启·首轮': '首轮', '开启·复用': '复用'}


async def main():
    load_env()  # 自动读取 config/local.env，新终端不必先 source
    parser = argparse.ArgumentParser(description='合同RAG：不同缓存的实际调用量与查询结果对比')
    parser.add_argument('--fixture', action='store_true', help='确定性机制验证，不调用模型，不代表GPU性能')
    parser.add_argument('--cache', choices=['all', 'semantic', 'embedding', 'prompt', 'rag', 'tool', 'ingestion'], default='all')
    parser.add_argument('--repeat', type=int, default=3, help='每个状态重复采样次数，取中位数（建议 3–5）')
    args = parser.parse_args()
    backend = Backend(args.fixture)
    service = None
    if not args.fixture:
        service = ensure_local_service(backend.embedding_base)
        backend.require_local_services()
    print('模式：'+('确定性夹具；耗时不代表模型或GPU性能，Token未知' if args.fixture else '已配置的真实服务'))
    report = {}
    try:
        for layer, title in [('semantic', 'Semantic Cache'), ('embedding', 'Embedding Cache：重复入库与查询'),
                             ('rag', 'RAG Cache：召回与重排'), ('tool', 'Tool Result Cache')]:
            if args.cache not in ('all', layer):
                continue
            question, rows, answers, _ = await cache_comparison(backend, layer, args.repeat)
            print(f'\n{title}（{args.repeat} 次采样中位数；计数是主判据）')
            table(['状态', '编码请求', '编码文本', '召回', '重排', '正文读取', '生成',
                   '缓存阶段ms', '生成ms', '生成Token', '相对关闭'], [
                [r['state'], r['counts'].get('embedding_requests', 0), r['counts'].get('embedding_texts', 0),
                 r['counts'].get('retrieval_requests', 0), r['counts'].get('rerank_requests', 0),
                 r['counts'].get('body_reads', 0), r['counts'].get('generation_requests', 0),
                 r['cache_stage_ms'], r['generate_ms'], r['tokens'], diff_text(r, rows[0])] for r in rows])
            print('阶段ms    '+' | '.join(f"{SHORT[r['state']]} {span(r['cache_stage_ms'], r['cache_stage_range'])}" for r in rows))
            print('生成ms    '+' | '.join(f"{SHORT[r['state']]} {span(r['generate_ms'], r['generate_range'])}" for r in rows))
            peak = max([r['cache_stage_ms'] for r in rows] or [0])
            print('阶段对比  '+' | '.join(f"{SHORT[r['state']]} {bar(r['cache_stage_ms'], peak)} {r['cache_stage_ms']}" for r in rows))
            retried = [f"{SHORT[r['state']]} {r['retried']} 次" for r in rows if r.get('retried')]
            if retried:
                print('验收重试  '+ ' | '.join(retried) + '（重试会额外调一次生成，已计入上方计数与耗时）')
            print('查询：'+question)
            for label, answer in zip(['关闭', '开启·首轮', '开启·复用'], answers):
                print(label+'结果：'+answer_text(answer))
            report[layer] = {'question': question, 'repeat': args.repeat, 'states': rows}
        if args.cache in ('all', 'ingestion'):
            rows, _ = await ingestion_comparison(backend)
            print('\nIngestionCache')
            table(['状态', '耗时ms', '切分执行', '编码请求', '编码文本', '输出节点'], rows)
        if args.cache in ('all', 'prompt'):
            result = await prompt_comparison(backend)
            print('\nPrompt Cache：由推理服务启用；比较首次请求与重复前缀')
            if result is None:
                print('未测：夹具没有推理服务缓存回执。')
            else:
                rows, answers = result
                table(['请求', '耗时ms', '输入/输出Token', '缓存读取Token'], rows)
                for label, answer in zip(['首次请求', '重复前缀'], answers):
                    print(label+'结果：'+answer_text(answer))
        if report:
            target = Path(__file__).resolve().parent/'output'/'caches.json'
            target.parent.mkdir(exist_ok=True)
            target.write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print('\n报告：'+str(target))
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
