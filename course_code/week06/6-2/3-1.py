"""3-1 按任务选择能力层：应用只发逻辑模型名，LiteLLM 决定该层用哪个部署。

Run: python 3-1.py [--tasks metadata,qa,compare] [--port 4000] [--timeout 120] [--fixture]

默认自动拉起 LiteLLM 网关（config/litellm.deepseek.yaml）：
  rag-fast、rag-capable → deepseek-flash，rag-reasoning → deepseek-v4-pro。
脚本结束时关闭本次启动的网关；已经手工运行的网关原地复用。
--fixture 离线演示选层与请求负载，不调用模型，不代表任何模型能力。
"""
import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from statistics import median

import httpx
import yaml
from llama_index.core.llms import ChatMessage
from llama_index.llms.openai_like import OpenAILike

from lab.env import load_env
from lab.teaching import table

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT/'config/litellm.deepseek.yaml'
QUESTION = '今年采购合同的违约金上限是多少？与去年模板相比变化多少？'
# 教学示例；实际内容由检索链路按当前权限读取。
EVIDENCE = """
[今年合同·第八条] 违约金累计上限为合同总额的8%。
[去年模板·第八条] 违约金累计上限为合同总额的10%。
"""

# 三个逻辑模型名只出现在应用里；哪一层落到哪个部署由网关配置决定。
TIERS = {'rag-fast': '简单分类、查询改写、常规摘要、字段抽取',
         'rag-capable': '常规证据问答',
         'rag-reasoning': '复杂条款比较、矛盾分析、综合判断'}
# 简单任务不需要长输出；推理层要留出思考 token，否则会被 max_tokens 截断。
TIER_MAX_TOKENS = {'rag-fast': 512, 'rag-capable': 800, 'rag-reasoning': 2048}
# 任务 → (能力层, 任务名, 系统指令, 用户输入)；选层由应用显式决定。
TASKS = {
    'classify': ('rag-fast', '判断问题类型', '判断问题属于哪类：字段抽取、证据问答还是跨版本比较？返回JSON，字段kind。', QUESTION),
    'rewrite': ('rag-fast', '生成检索查询', '把问题改写成一条检索查询，保留版本与条款限定词。返回JSON，字段query。', QUESTION),
    'metadata': ('rag-fast', '抽取合同元数据', '抽取每份文档的违约金上限和计算基数，返回JSON。', EVIDENCE),
    'qa': ('rag-capable', '常规证据问答', '根据证据回答：今年合同的违约金上限是多少？引用条款。', EVIDENCE),
    'compare': ('rag-reasoning', '跨版本条款比较', '比较两份条款。先确认计算基数，再说明上限变化，引用双方条款。', EVIDENCE),
    'conflict': ('rag-reasoning', '矛盾分析', '两份条款是否存在矛盾或不一致？先判断计算基数是否相同，再逐条指出差异并引用原文。', EVIDENCE),
    'synthesis': ('rag-reasoning', '综合判断', '综合两份证据给出结论：上限收紧了多少，是否存在解释风险？引用双方条款。', EVIDENCE),
}
DEFAULT_TASKS = ('metadata', 'qa', 'compare')
# 证据里真实出现的百分数；回答中超出这些数字的部分属于模型推导，需人工核对。
KNOWN_PERCENTS = {float(n) for n in re.findall(r'(\d+(?:\.\d+)?)\s*[%％]', EVIDENCE)}


def configured():
    """配置文件里的别名→部署，用于网关没起来或查不到时的对照。"""
    if not CONFIG.exists():
        return {}, {}
    data = yaml.safe_load(CONFIG.read_text()) or {}
    mapping = {item.get('model_name'): {'model': str(item.get('litellm_params', {}).get('model', '')),
                                        'api_base': str(item.get('litellm_params', {}).get('api_base', '')),
                                        'api_key': str(item.get('litellm_params', {}).get('api_key', ''))}
               for item in data.get('model_list') or []}
    fallbacks = {}
    for item in (data.get('router_settings') or {}).get('fallbacks') or []:
        for alias, targets in item.items():
            fallbacks[alias] = targets
    return mapping, fallbacks


def log_path():
    directory = ROOT/'output'
    directory.mkdir(exist_ok=True)
    return directory/'litellm.log'


def tail(path, lines=15):
    try:
        return '\n'.join(Path(path).read_text(errors='replace').splitlines()[-lines:])
    except Exception:
        return ''


def gateway_get(base, path, api_key, timeout=5):
    """网关查询失败返回原因，不猜测结果。"""
    try:
        response = httpx.get(base+path, headers={'Authorization': f'Bearer {api_key}'},
                             timeout=timeout, trust_env=False)
        response.raise_for_status()
        return response.json(), None
    except Exception as error:
        return None, f'{type(error).__name__}: {error}'


def gateway_models(base, api_key, timeout=5):
    data, error = gateway_get(base, '/models', api_key, timeout)
    return (None, error) if error else ([item['id'] for item in data.get('data') or []], None)


def deployments(base, api_key, timeout=10):
    """网关实际生效的别名→部署，来自 /v1/model/info，不做额外推理调用。"""
    data, error = gateway_get(base, '/model/info', api_key, timeout)
    if error:
        return {}
    return {item.get('model_name'): str((item.get('litellm_params') or {}).get('model', ''))
            for item in data.get('data') or []}


def stop(proc):
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def start_gateway(port, api_key, upstream_key, wait=180):
    """返回 (base, 本次启动的进程)；复用已运行网关时进程为 None。"""
    base = f'http://127.0.0.1:{port}/v1'
    aliases, _ = gateway_models(base, api_key, 2)
    if aliases is not None:
        missing = [name for name in TIERS if name not in aliases]
        if missing:
            raise RuntimeError(f'端口 {port} 上已有服务但缺少逻辑模型名：'+'、'.join(missing)
                               +'；先停掉它，或用 --port 换一个端口')
        return base, None
    executable = shutil.which('litellm', path=str(Path(sys.executable).parent)) or 'litellm'
    print('正在拉起 litellm 进程，首次加载约 20–30 秒……')
    env = dict(os.environ, DEEPSEEK_API_KEY=upstream_key, LITELLM_MASTER_KEY=api_key)
    log = open(log_path(), 'wb')
    proc = subprocess.Popen([executable, '--config', str(CONFIG), '--host', '127.0.0.1',
                             '--port', str(port)], cwd=str(ROOT), env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    log.close()
    deadline = time.monotonic()+wait
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError('LiteLLM 启动失败，日志 '+str(log_path())+'：\n'+tail(log_path()))
        aliases, _ = gateway_models(base, api_key, 2)
        if aliases is not None:
            missing = [name for name in TIERS if name not in aliases]
            if missing:
                stop(proc)
                raise RuntimeError('网关已启动但缺少逻辑模型名：'+'、'.join(missing)
                                   +'；检查 '+CONFIG.name+' 的 model_name')
            return base, proc
        time.sleep(1)
    stop(proc)
    raise RuntimeError('LiteLLM 启动超时，日志 '+str(log_path())+'：\n'+tail(log_path()))


def parse_json(text):
    try:
        return json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip()))
    except Exception:
        return None


def evidence_check(text):
    """确定性检查：证据数值是否复述、是否引到条款；语义与推导仍要人工验收。"""
    found = {float(n) for n in re.findall(r'(\d+(?:\.\d+)?)\s*[%％]', text)}
    hit = '、'.join(f'{p:g}%' for p in sorted(found & KNOWN_PERCENTS)) or '无'
    extra = '、'.join(f'{p:g}%' for p in sorted(found - KNOWN_PERCENTS)) or '无'
    clause = '出现' if '第八条' in text else '未出现'
    shape = 'JSON可解析' if parse_json(text) is not None else '非JSON'
    return f'证据数字 {hit}｜额外推导 {extra}｜第八条 {clause}｜{shape}'


def ask(models, tier, system, content):
    """应用只发逻辑模型名；该层用哪个部署由网关决定。"""
    started = time.perf_counter()
    response = models[tier].chat([ChatMessage(role='system', content=system),
                                  ChatMessage(role='user', content=content)])
    elapsed = round(time.perf_counter()-started, 2)
    usage = getattr(getattr(response, 'raw', None), 'usage', None)
    tokens = (f"{getattr(usage, 'prompt_tokens', '?')}/{getattr(usage, 'completion_tokens', '?')}"
              if usage else '未知')
    return {'text': (response.message.content or '').strip(), 'elapsed': elapsed, 'tokens': tokens}


def deployment(live, mapping, tier):
    """该层实际生效的部署；网关查不到时退回配置文件。"""
    return (live.get(tier) or mapping.get(tier, {}).get('model') or '未知').replace('openai/', '')


def main():
    load_env()  # 自动读取 config/local.env，新终端不必先 source
    parser = argparse.ArgumentParser(description='合同RAG：按任务选择能力层（rag-fast/rag-capable/rag-reasoning）')
    parser.add_argument('--tasks', default=','.join(DEFAULT_TASKS), help='逗号分隔：'+'、'.join(TASKS))
    parser.add_argument('--port', type=int, default=int(os.getenv('DEMO_GATEWAY_PORT', '4000')))
    parser.add_argument('--fixture', action='store_true', help='离线演示选层与请求负载，不调用模型')
    parser.add_argument('--timeout', type=float, default=120.)
    args = parser.parse_args()
    picked = [name.strip() for name in args.tasks.split(',') if name.strip()]
    unknown = [name for name in picked if name not in TASKS]
    if unknown:
        parser.error('未知任务：'+'、'.join(unknown))
    if not picked:
        parser.error('至少选择一个任务')

    api_key = os.getenv('LITELLM_MASTER_KEY') or 'sk-litellm-3-1-demo'
    upstream_key = os.getenv('DEEPSEEK_API_KEY') or os.getenv('LITELLM_API_KEY') or ''
    proc, base, live = None, '', {}
    try:
        if args.fixture:
            print('模式：离线夹具；只验证选层与请求负载，不调用模型')
        else:
            if not upstream_key:
                raise ValueError('请设置 DEEPSEEK_API_KEY 或 LITELLM_API_KEY：网关要拿它调用 DeepSeek。')
            print(f'检查 LiteLLM 网关（{CONFIG.name}，端口 {args.port}）……')
            base, proc = start_gateway(args.port, api_key, upstream_key)
            print('网关就绪：'+base+('（本次启动，退出时关闭）' if proc else '（复用已在运行的网关）'))
            live = deployments(base, api_key)

        mapping, _ = configured()
        print('部署：'+'｜'.join(f'{name}→{deployment(live, mapping, name)}' for name in TIERS))

        models = {name: OpenAILike(model=name, api_base=base, api_key=api_key, is_chat_model=True,
                                   context_window=8192, max_tokens=TIER_MAX_TOKENS[name],
                                   temperature=0, max_retries=0, timeout=args.timeout)
                  for name in TIERS} if not args.fixture else {}

        results, failed = [], 0
        for index, task_name in enumerate(picked, 1):
            tier, label, system, content = TASKS[task_name]
            print(f'\n[{index}/{len(picked)}] {label} → {tier}（{TIERS[tier]}）')
            if args.fixture:
                print('系统指令：'+system)
                print('用户输入：'+content.strip().replace('\n', ' / '))
                print('未调用模型；真实运行时由网关把 '+tier+' 路由到该层部署。')
                continue
            try:
                result = ask(models, tier, system, content)
            except Exception as error:
                failed += 1
                print(f'调用失败：{type(error).__name__}: {error}')
                continue
            deploy = deployment(live, mapping, tier)
            print(f"耗时 {result['elapsed']}s｜应用发送 model={tier}｜该层部署 {deploy}"
                  f"｜Token {result['tokens']}")
            print('结果：'+(result['text'].replace('\n', ' ') or '空'))
            print('校验：'+evidence_check(result['text']))
            results.append({'label': label, 'tier': tier, 'deploy': deploy,
                            'seconds': result['elapsed'], 'tokens': result['tokens']})

        if results:
            total = sum(item['seconds'] for item in results)
            slowest = max(results, key=lambda item: item['seconds'])
            fastest = min(results, key=lambda item: item['seconds'])
            print('\n执行时间统计（只统计模型调用，不含网关启动）')
            table(['任务', '能力层', '部署', '耗时s', '占比', 'Token 入/出'], [
                [item['label'], item['tier'], item['deploy'], f"{item['seconds']:.2f}",
                 f"{item['seconds']/total*100:.0f}%", item['tokens']] for item in results])

        if failed:
            raise RuntimeError(f'{failed} 个任务未完成')
    finally:
        if proc is not None:
            stop(proc)
            print('\n已关闭本次启动的网关。')


if __name__ == '__main__':
    logging.disable(logging.WARNING)
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print('执行未完成：'+str(error), file=sys.stderr)
        sys.exit(1)
