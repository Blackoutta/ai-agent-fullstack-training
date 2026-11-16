"""3-2 服务出错和上下文超限：走不同的备用路径。

Run: python 3-2.py [--port 4000] [--timeout 120]

所有可配置项都在文件里，不再需要手工 export：
  config/local.env               FLASH_API_BASE / FLASH_API_KEY / PRO_API_BASE / PRO_API_KEY / LITELLM_MASTER_KEY
  config/litellm.fallback.yaml   model_list + router_settings.fallbacks / allowed_fails / cooldown_time

脚本自己读配置并拉起 LiteLLM 网关，两条请求只换模型别名，Python 里没有故障切换逻辑：
  rag-fast          正常由 Flash 处理；
  rag-failure-test  先打本机未监听端口，再由网关按 fallbacks 切到 Pro。
退出时关闭本次启动的网关；已手工运行的同配置网关原地复用。
"""
import argparse
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
import yaml
from llama_index.core.llms import ChatMessage
from llama_index.llms.openai_like import OpenAILike

from lab.env import load_env
from lab.teaching import table

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT/'config/litellm.fallback.yaml'
# 网关配置里出现的别名；启动后逐个核对，缺哪个就报哪个。
ALIASES = ('rag-fast', 'rag-reasoning', 'rag-failure-test')
# 网关启动前必须齐备的变量；缺项直接报错，不去猜端点。
REQUIRED = ('FLASH_API_BASE', 'FLASH_API_KEY', 'PRO_API_BASE', 'PRO_API_KEY')
# 没单独配置时沿用生成端点，避免同一把密钥在 local.env 里写两遍。
DERIVED = {'FLASH_API_BASE': 'LITELLM_API_BASE', 'FLASH_API_KEY': 'LITELLM_API_KEY',
           'PRO_API_BASE': 'LITELLM_API_BASE', 'PRO_API_KEY': 'LITELLM_API_KEY'}
DEFAULT_MASTER_KEY = 'sk-local-routing-demo'
MESSAGES = [
    ChatMessage(role='system',
                content='只根据提供的条款回答，保留计算基数，引用条款编号。'),
    ChatMessage(role='user',
                content=('今年合同第八条：违约金累计上限为合同总额的8%。\n'
                         '去年模板第八条：违约金累计上限为合同总额的10%。\n'
                         '问题：今年相比去年有什么变化？')),
]


def normalize_base(url):
    """端点只有主机名时补 /v1；已经带路径的照原样使用。"""
    url = (url or '').strip().rstrip('/')
    if not url:
        return url
    return url if '/' in url.split('://', 1)[-1] else url+'/v1'


def resolve_env():
    """把配置文件的变量准备好，缺项时给出可执行的提示。"""
    values, missing = {}, []
    for name in REQUIRED:
        value = os.getenv(name)
        if not value and name in DERIVED:
            source = os.getenv(DERIVED[name])
            if source:
                value = normalize_base(source) if name.endswith('_BASE') else source
        if not value:
            hint = name+'（或 '+DERIVED[name]+'）' if name in DERIVED else name
            missing.append(hint)
        values[name] = value
    if missing:
        raise ValueError('config/local.env 缺少：'+'、'.join(missing))
    api_key = os.getenv('LITELLM_MASTER_KEY') or DEFAULT_MASTER_KEY
    values['LITELLM_MASTER_KEY'] = api_key
    os.environ.update(values)  # 网关子进程直接继承，无需再 export
    return values, api_key


def router_config():
    """配置文件里的备用路径与重试、冷却、限流参数，用于输出对照。"""
    data = yaml.safe_load(CONFIG.read_text()) or {}
    router = data.get('router_settings') or {}
    fallbacks = {}
    for item in router.get('fallbacks') or []:
        for alias, targets in item.items():
            fallbacks[alias] = list(targets or [])
    windows = {}
    for item in router.get('context_window_fallbacks') or []:
        for alias, targets in item.items():
            windows[alias] = list(targets or [])
    limits = {}
    for item in data.get('model_list') or []:
        params = item.get('litellm_params') or {}
        limits[item.get('model_name')] = {key: params.get(key) for key in
                                          ('rpm', 'tpm', 'max_parallel_requests', 'timeout')}
    return router, fallbacks, windows, limits


def log_path():
    directory = ROOT/'output'
    directory.mkdir(exist_ok=True)
    return directory/'litellm-fallback.log'


def tail(path, lines=15):
    try:
        return '\n'.join(Path(path).read_text(errors='replace').splitlines()[-lines:])
    except Exception:
        return ''


def gateway_get(base, path, api_key, timeout=5):
    """网关查询失败返回原因，不猜结果。"""
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
    """网关实际生效的别名→部署，来自 /v1/model/info，不额外发起推理调用。"""
    data, error = gateway_get(base, '/model/info', api_key, timeout)
    if error:
        return {}
    live = {}
    for item in data.get('data') or []:
        params = item.get('litellm_params') or {}
        live[item.get('model_name')] = {'model': str(params.get('model', '')).replace('openai/', ''),
                                        'api_base': str(params.get('api_base', ''))}
    return live


def stop(proc):
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def start_gateway(port, api_key, wait=180):
    """返回 (base, 本次启动的进程)；复用已运行网关时进程为 None。"""
    base = f'http://127.0.0.1:{port}/v1'
    aliases, _ = gateway_models(base, api_key, 2)
    if aliases is not None:
        missing = [name for name in ALIASES if name not in aliases]
        if missing:
            raise RuntimeError(f'端口 {port} 上已有服务但缺少别名：'+'、'.join(missing)
                               +'；先停掉它，或用 --port 换一个端口')
        return base, None
    executable = shutil.which('litellm', path=str(Path(sys.executable).parent)) or 'litellm'
    print('正在拉起 litellm 进程，首次加载约 20–30 秒……')
    log = open(log_path(), 'wb')
    proc = subprocess.Popen([executable, '--config', str(CONFIG), '--host', '127.0.0.1',
                             '--port', str(port)], cwd=str(ROOT), env=dict(os.environ),
                            stdout=log, stderr=subprocess.STDOUT)
    log.close()
    deadline = time.monotonic()+wait
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError('LiteLLM 启动失败，日志 '+str(log_path())+'：\n'+tail(log_path()))
        aliases, _ = gateway_models(base, api_key, 2)
        if aliases is not None:
            missing = [name for name in ALIASES if name not in aliases]
            if missing:
                stop(proc)
                raise RuntimeError('网关已启动但缺少别名：'+'、'.join(missing)
                                   +'；检查 '+CONFIG.name+' 的 model_name')
            return base, proc
        time.sleep(1)
    stop(proc)
    raise RuntimeError('LiteLLM 启动超时，日志 '+str(log_path())+'：\n'+tail(log_path()))


def field(raw, name, default='未返回'):
    """不同版本返回对象或字典，取值时两者都兼容。"""
    if isinstance(raw, dict):
        return raw.get(name) or default
    return getattr(raw, name, None) or default


def ask(base, api_key, alias, timeout):
    """应用只发别名；故障切换在网关，Python 里没有 try/except 换模型的逻辑。"""
    llm = OpenAILike(model=alias, api_base=base, api_key=api_key, is_chat_model=True,
                     context_window=8192, max_tokens=1024, temperature=0,
                     max_retries=0, timeout=timeout)
    started = time.perf_counter()
    response = llm.chat(MESSAGES)
    elapsed = time.perf_counter()-started
    usage = field(getattr(response, 'raw', None), 'usage', None)
    tokens = '未知'
    if usage is not None:
        prompt = field(usage, 'prompt_tokens', '?')
        completion = field(usage, 'completion_tokens', '?')
        tokens = f'{prompt}/{completion}'
    return {'model': str(field(getattr(response, 'raw', None), 'model')),
            'text': (response.message.content or '').strip(),
            'elapsed': elapsed, 'tokens': tokens}


def route(base, api_key, alias, live, fallbacks, labels, timeout):
    """一次真实请求 + 返回模型字段判定，只有真的换了部署才记为切换。"""
    print(f'\n{labels[alias]}')
    print('请求别名：'+alias)
    try:
        result = ask(base, api_key, alias, timeout)
    except Exception as error:
        raise RuntimeError(f'别名 {alias} 请求失败，网关未按 fallbacks 兜住：'
                           f'{type(error).__name__}: {error}') from error
    returned = result['model'].replace('openai/', '')
    primary = (live.get(alias) or {}).get('model', '')
    targets = [live.get(name, {}).get('model') or name for name in fallbacks.get(alias) or []]
    # 未切换时网关回填请求别名，切换后才回填实际部署名；两者都按“主部署”计。
    switched = bool(targets) and returned in targets
    primary_hit = returned in (alias, primary)
    print(f"服务返回模型：{returned}｜耗时 {result['elapsed']:.2f} 秒｜Token 输入/输出 {result['tokens']}")
    if switched:
        print(f'判定：主部署 {primary or "未查到"} 失败，网关切到备用部署 {returned}。')
    elif primary_hit:
        print(f'判定：主部署直接返回（返回字段 {returned}），未触发备用路径。')
    else:
        print(f'判定：返回模型 {returned} 与配置不符，需核对网关配置与日志。')
    print('答案：'+(result['text'].replace('\n', ' ') or '空'))
    return {'label': labels[alias], 'alias': alias, 'returned': returned, 'tokens': result['tokens'],
            'target': '、'.join(targets) or '未配置', 'elapsed': result['elapsed'],
            'switched': switched, 'primary': primary}


def log_evidence():
    """网关日志里的备用切换记录，作为返回模型字段之外的旁证。"""
    try:
        lines = Path(log_path()).read_text(errors='replace').splitlines()
    except Exception:
        return []
    pattern = re.compile(r'fallback|falling back|fall back', re.I)
    return [line.strip() for line in lines if pattern.search(line)][-3:]


def main():
    load_env()  # 自动读取 config/local.env，新终端不必先 source
    parser = argparse.ArgumentParser(description='合同RAG：服务故障与上下文超限的备用路径')
    parser.add_argument('--port', type=int, default=int(os.getenv('DEMO_GATEWAY_PORT', '4000')))
    parser.add_argument('--timeout', type=float, default=120., help='单次请求超时秒数')
    args = parser.parse_args()
    if not CONFIG.exists():
        raise ValueError('缺少网关配置：'+str(CONFIG))

    router, fallbacks, windows, limits = router_config()
    values, api_key = resolve_env()
    print('配置：'+CONFIG.name+'｜导出项来自 config/local.env')
    print('部署端点：rag-fast→'+values['FLASH_API_BASE']
          +'｜rag-reasoning→'+values['PRO_API_BASE']+'｜rag-failure-test→本机未监听端口')

    proc, base, live = None, '', {}
    try:
        base, proc = start_gateway(args.port, api_key)
        print('网关就绪：'+base+('（本次启动，退出时关闭）' if proc else '（复用已在运行的网关）'))
        live = deployments(base, api_key)
        print('实际部署：'+'｜'.join(
            f"{name}→{(live.get(name) or {}).get('model', '未查到')}"
            for name in ALIASES))

        labels = {'rag-fast': '第一条：正常请求',
                  'rag-failure-test': '第二条：主部署故障后的请求'}
        results = [route(base, api_key, alias, live, fallbacks, labels, args.timeout)
                   for alias in ('rag-fast', 'rag-failure-test')]

        print('\n执行路径对照')
        table(['请求', '别名', '返回模型', '备用目标', '路径', '耗时s', 'Token 入/出'], [
            [item['label'], item['alias'], item['returned'], item['target'],
             '备用切换' if item['switched'] else '主部署', f"{item['elapsed']:.2f}", item['tokens']]
            for item in results])
        print('说明：未切换时网关回填请求别名，切换后才回填实际部署名；两次请求只换了别名，'
              'Python 里没有故障判断和重试逻辑。')

        print('\n配置要点')
        print('router_settings：num_retries={}｜max_fallbacks={}｜allowed_fails={}｜cooldown_time={}s'.format(
            router.get('num_retries'), router.get('max_fallbacks'),
            router.get('allowed_fails'), router.get('cooldown_time')))
        print('普通备用路径：'+'｜'.join(f'{k}→{"、".join(v)}' for k, v in fallbacks.items()))
        print('限流（部署级）：'+'｜'.join(
            f'{name}: rpm={item.get("rpm")} tpm={item.get("tpm")} 并发={item.get("max_parallel_requests")}'
            for name, item in limits.items() if name in ('rag-fast', 'rag-reasoning')))
        if windows:
            print('上下文超限路径：'+'｜'.join(f'{k}→{"、".join(v)}' for k, v in windows.items()))
        else:
            print('上下文超限路径：未启用（context_window_fallbacks 仍在配置里注释）。')
            print('  超限要向应用暴露可识别的错误：先去重、删减无关证据，仍放不下才切窗口更大的部署。')
        print('  窗口大小不等于模型能力，备用部署需提前验证工具调用、输出格式、数据权限与预算。')
        print('冷却语义：失败达到 allowed_fails 后进入 cooldown_time 冷却，只是暂时避开故障节点，'
              '不代表已恢复；重试只在网关这一层做一次，客户端与应用适配器不要再叠加。')

        evidence = log_evidence()
        if evidence:
            print('\n网关日志旁证')
            for line in evidence:
                print('  '+line)

        # 第一条本来就不该切换，只有故障别名没切到备用部署才算失败。
        if not results[1]['switched']:
            raise RuntimeError('故障别名没有切到备用部署，检查 fallbacks 与备用部署可用性')
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
