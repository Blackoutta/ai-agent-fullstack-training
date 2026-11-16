"""按需拉起本机编码/重排服务，避免每次运行前手工开第二个终端。

只在编码端点是 127.0.0.1/localhost 且 EMBEDDING_AUTOSTART=1（默认）时生效。
服务进程由本次运行创建，脚本结束时关闭；已经手工启动的服务原地复用，不会被关掉。
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]


def origin(url):
    return '/'.join(url.rstrip('/').split('/')[:3])


def is_local(url):
    return any(host in url for host in ('127.0.0.1', 'localhost'))


def alive(base, timeout=1.5):
    try:
        return httpx.get(origin(base)+'/health', timeout=timeout).status_code == 200
    except Exception:
        return False


def log_path():
    directory = ROOT/'output'
    directory.mkdir(exist_ok=True)
    return directory/'local-embedding.log'


def child_env():
    """模型首次需要下载时走国内镜像；已缓存时不影响加载。"""
    env = dict(os.environ)
    env.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')
    return env


def ensure(base, wait=180):
    """返回本次拉起的进程；不需要或服务已在运行时返回 None。"""
    if not is_local(base) or alive(base):
        return None
    if os.getenv('EMBEDDING_AUTOSTART', '1') != '1':
        return None
    log = open(log_path(), 'ab')
    proc = subprocess.Popen([sys.executable, '-m', 'lab.local_embedding_service'], cwd=str(ROOT),
                            env=child_env(), stdout=log, stderr=subprocess.STDOUT)
    log.close()
    deadline = time.monotonic()+wait
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError('本机编码/重排服务启动失败，手工运行看看报错：'
                               'python -m lab.local_embedding_service')
        if alive(base):
            return proc
        time.sleep(.5)
    stop(proc)
    raise RuntimeError('本机编码/重排服务启动超时')


def stop(proc):
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
