import { queryOptions } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '../../api'
import type { components } from '../../api/schema'

export type UserListItem = components['schemas']['UserListItem']
export type CreateUserResponse = components['schemas']['CreateUserResponse']
export type RotateKeyResponse = components['schemas']['RotateKeyResponse']

export const USERS_KEY = ['auth', 'users'] as const

export function usersQueryOptions(apiClient: ApiClient | undefined) {
  return queryOptions({
    queryKey: USERS_KEY,
    queryFn: async (): Promise<UserListItem[]> => {
      if (!apiClient) throw new Error('user list query requires an active connection')
      const { data, response } = await apiClient.api.GET('/store-api/auth/users')
      if (!response.ok || !data) throw new ApiError(response.status, 'user list failed')
      return data
    },
    enabled: apiClient !== undefined,
  })
}

function messageForCreateUserError(status: number): string {
  if (status === 409) return 'user already exists'
  if (status === 400) return 'invalid username'
  return `create user failed (HTTP ${status})`
}

export async function createUser(apiClient: ApiClient, name: string): Promise<CreateUserResponse> {
  const { data, response } = await apiClient.api.POST('/store-api/auth/users', { body: { name } })
  if (!response.ok || !data) throw new ApiError(response.status, messageForCreateUserError(response.status))
  return data
}

export async function deleteUser(apiClient: ApiClient, name: string): Promise<void> {
  const { response } = await apiClient.api.DELETE('/store-api/auth/users/{name}', { params: { path: { name } } })
  if (!response.ok) throw new ApiError(response.status, response.status === 404 ? 'user not found' : 'delete user failed')
}

export async function rotateUserKey(apiClient: ApiClient, name: string): Promise<RotateKeyResponse> {
  const { data, response } = await apiClient.api.POST('/store-api/auth/users/{name}/rotate-key', { params: { path: { name } } })
  if (!response.ok || !data) throw new ApiError(response.status, response.status === 404 ? 'user not found' : 'rotate key failed')
  return data
}
