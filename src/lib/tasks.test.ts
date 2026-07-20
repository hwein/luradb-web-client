import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { noteReindexStart, resetReindexTasks, updateReindexTaskStatus, useReindexTasks } from './tasks'

afterEach(() => {
  resetReindexTasks()
})

describe('tasks', () => {
  it('registers a task from a matching reindex POST path and a task_id body', () => {
    const { result } = renderHook(() => useReindexTasks())

    act(() => noteReindexStart('/store-api/json/shop/reindex', { task_id: 'task_1' }))

    expect(result.current).toEqual([{ taskId: 'task_1', domain: 'shop', startedAt: expect.any(Number), status: { kind: 'running', processed: 0, totalEstimated: 0 } }])
  })

  it('decodes a URL-encoded domain from the path', () => {
    const { result } = renderHook(() => useReindexTasks())

    act(() => noteReindexStart('/store-api/json/my%20domain/reindex', { task_id: 'task_1' }))

    expect(result.current[0]?.domain).toBe('my domain')
  })

  it('ignores paths that are not a reindex-start path', () => {
    const { result } = renderHook(() => useReindexTasks())

    act(() => {
      noteReindexStart('/store-api/json/shop/reindex/task_1', { task_id: 'task_1' })
      noteReindexStart('/store-api/json/shop/search', { task_id: 'task_1' })
      noteReindexStart('/store-api/kv/shop/reindex', { task_id: 'task_1' })
    })

    expect(result.current).toEqual([])
  })

  it('ignores a response body without a string task_id', () => {
    const { result } = renderHook(() => useReindexTasks())

    act(() => {
      noteReindexStart('/store-api/json/shop/reindex', {})
      noteReindexStart('/store-api/json/shop/reindex', { task_id: 42 })
      noteReindexStart('/store-api/json/shop/reindex', null)
      noteReindexStart('/store-api/json/shop/reindex', 'not an object')
    })

    expect(result.current).toEqual([])
  })

  it('appends multiple tasks in registration order', () => {
    const { result } = renderHook(() => useReindexTasks())

    act(() => {
      noteReindexStart('/store-api/json/shop/reindex', { task_id: 'task_1' })
      noteReindexStart('/store-api/json/logs/reindex', { task_id: 'task_2' })
    })

    expect(result.current.map((task) => task.taskId)).toEqual(['task_1', 'task_2'])
  })

  it('updateReindexTaskStatus updates a known task in place', () => {
    const { result } = renderHook(() => useReindexTasks())
    act(() => noteReindexStart('/store-api/json/shop/reindex', { task_id: 'task_1' }))

    act(() => updateReindexTaskStatus('task_1', { kind: 'completed', processed: 10, durationSecs: 3 }))

    expect(result.current[0]?.status).toEqual({ kind: 'completed', processed: 10, durationSecs: 3 })
  })

  it('updateReindexTaskStatus is a no-op for an unknown task id', () => {
    const { result } = renderHook(() => useReindexTasks())
    act(() => noteReindexStart('/store-api/json/shop/reindex', { task_id: 'task_1' }))

    act(() => updateReindexTaskStatus('does-not-exist', { kind: 'completed', processed: 10, durationSecs: 3 }))

    expect(result.current[0]?.status).toEqual({ kind: 'running', processed: 0, totalEstimated: 0 })
  })

  it('updateReindexTaskStatus does not notify listeners when the status is unchanged (no render loop)', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useReindexTasks()
    })
    act(() => noteReindexStart('/store-api/json/shop/reindex', { task_id: 'task_1' }))
    const rendersAfterRegister = renders

    act(() => updateReindexTaskStatus('task_1', { kind: 'running', processed: 0, totalEstimated: 0 }))

    expect(renders).toBe(rendersAfterRegister)
    expect(result.current[0]?.status).toEqual({ kind: 'running', processed: 0, totalEstimated: 0 })
  })
})
