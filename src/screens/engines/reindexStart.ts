import { withCall, type ApiClient, type CallMeta } from '../../api'
import type { components } from '../../api/schema'
import { noteReindexStart } from '../../lib/tasks'
import { messageFromError } from '../sql/sqlRun'

type ReindexAcceptedResponse = components['schemas']['ReindexAcceptedResponse']

export type StartReindexOutcome = { status: 'ok'; call: CallMeta; taskId: string } | { status: 'error'; call: CallMeta; message: string }

/**
 * UI-freier Reindex-Start (spec engines/002 §1/§5, für data/006): der REST-Explorer-Haken `noteReindexStart`
 * (spec engines/001 Orchestrator-Hinweis 1) bleibt der zweite Auslöser — bei 202 registriert dieser Call
 * denselben Task über denselben Pfad in derselben Registry.
 */
export async function startReindex(apiClient: ApiClient, domain: string, field?: string): Promise<StartReindexOutcome> {
  let errorBody: unknown
  const { data, call } = await withCall<ReindexAcceptedResponse>('POST', async () => {
    const result = await apiClient.api.POST('/store-api/json/{domain}/reindex', {
      params: { path: { domain } },
      body: { field },
    })
    errorBody = result.error
    return { data: result.data, response: result.response }
  })

  if (call.status === 202 && data !== undefined) {
    noteReindexStart(call.path, data)
    return { status: 'ok', call, taskId: data.task_id }
  }
  return { status: 'error', call, message: messageFromError(errorBody, call.status) }
}
