import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, downloadBlob, downloadReport, request } from '../src/api'
import { run, strategy, task } from './fixtures'
afterEach(() => vi.unstubAllGlobals())

describe('统一 API 契约', () => {
  it('发送 JSON 对象并正确编码路径 ID', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(run)))
    vi.stubGlobal('fetch', fetcher)
    await api.review('r/1', { reviewer: '张三', status: 'fail', reason: '证据不足' })
    expect(fetcher).toHaveBeenCalledWith('/api/runs/r%2F1/reviews', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ reviewer: '张三', status: 'fail', reason: '证据不足' }),
    }))
  })
  it('显示服务端 JSON 和纯文本错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"缺少凭据"}', { status: 400 }))
      .mockResolvedValueOnce(new Response('Worker 不可用', { status: 503 })))
    await expect(api.judge('r1')).rejects.toThrow('缺少凭据')
    await expect(api.state()).rejects.toThrow('Worker 不可用')
  })
  it('支持空 DELETE 响应', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await expect(api.deleteTask('t1')).resolves.toBeUndefined()
  })
  it('对比和报告使用同一套 query', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    const query = { baseline: 's 1', candidate: 's/2', experiment: 'e1' }
    await api.compare(query)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/compare?baseline=s+1&candidate=s%2F2&experiment=e1')
    expect(api.reportUrl(query, 'md')).toContain('experiment=e1&format=md')
  })
  it('CRUD、导入导出和取消符合设计路径', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await api.saveTask(task); await api.importTasks([task]); await api.exportTasks()
    await api.saveStrategy(strategy); await api.deleteStrategy('s1')
    await api.cancel('e1'); await api.run('r1')
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/tasks', '/api/tasks/import', '/api/tasks/export', '/api/strategies', '/api/strategies/s1', '/api/experiments/e1/cancel', '/api/runs/r1'])
  })
  it('报告 HTTP 失败不会触发下载', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('配对未完成', { status: 409 })))
    await expect(downloadReport({ baseline: 's1', candidate: 's2', experiment: 'e1' }, 'json')).rejects.toBeInstanceOf(ApiError)
  })
  it('释放导出对象 URL', () => {
    const create = vi.fn().mockReturnValue('blob:test')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadBlob(new Blob(['{}']), 'benchmark.json')
    expect(click).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:test')
    click.mockRestore()
  })
  it('保留网络异常给调用者处理', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('离线')))
    await expect(request('/state')).rejects.toThrow('离线')
  })
})
