import openapiDocument from '../../api/openapi.json'
import { BASE_PATH } from '../../api'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** Farbschema der Methodenspalte (spec §1): GET accent, POST/PATCH/PUT amber, DELETE err. */
export type MethodTone = 'acc' | 'json' | 'err'

export interface Endpoint {
  method: HttpMethod
  /** Vollständiger Pfad inkl. BASE_PATH, mit `{param}`-Templates. */
  path: string
  /** Pfad ohne BASE_PATH-Präfix — reine Anzeige (spec §1). */
  displayPath: string
  tag: string
  hasBody: boolean
  /** JSON-Text des Minimal-Beispiels (required-Felder); '' wenn kein Body. */
  bodyExample: string
}

export interface EndpointGroup {
  tag: string
  endpoints: Endpoint[]
}

interface OpenApiSchema {
  $ref?: string
  type?: string
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  items?: OpenApiSchema
}

interface Operation {
  tags?: string[]
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> }
}

interface OpenApiDoc {
  paths: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, OpenApiSchema> }
  tags?: { name: string }[]
}

const doc = openapiDocument as unknown as OpenApiDoc

export function methodTone(method: HttpMethod): MethodTone {
  if (method === 'GET') return 'acc'
  if (method === 'DELETE') return 'err'
  return 'json'
}

export function displayPathOf(path: string): string {
  return path.startsWith(BASE_PATH) ? path.slice(BASE_PATH.length) : path
}

/** Namen der `{param}`-Templates in Reihenfolge ihres Auftretens. */
export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)
}

/** Ersetzt `{param}` durch den (URL-kodierten) Wert; leere Werte bleiben als `{param}` sichtbar. */
export function applyPathParams(path: string, values: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const value = values[name]
    return value !== undefined && value !== '' ? encodeURIComponent(value) : whole
  })
}

/** Destruktiver Guard (spec §3): DELETE oder key-rotierende Pfade verlangen einen Bestätigungsklick. */
export function isDestructive(method: HttpMethod, path: string): boolean {
  return method === 'DELETE' || path.includes('rotate-key')
}

function derefSchema(schema: OpenApiSchema | undefined): OpenApiSchema | undefined {
  let current = schema
  const seen = new Set<string>()
  while (current?.$ref !== undefined) {
    if (seen.has(current.$ref)) return undefined
    seen.add(current.$ref)
    const name = current.$ref.split('/').pop()
    current = name === undefined ? undefined : doc.components?.schemas?.[name]
  }
  return current
}

function isObjectSchema(schema: OpenApiSchema | undefined): boolean {
  return schema !== undefined && (schema.type === 'object' || schema.properties !== undefined)
}

function typeDefault(schema: OpenApiSchema | undefined): unknown {
  switch (schema?.type) {
    case 'string':
      return ''
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    default:
      return {}
  }
}

/** Minimal-Beispiel: nur required-Felder mit Typ-Defaults; eine Rekursionsebene für required-Objektfelder. */
function buildExample(schema: OpenApiSchema | undefined, depth: number): unknown {
  const resolved = derefSchema(schema)
  if (!isObjectSchema(resolved)) return typeDefault(resolved)

  const result: Record<string, unknown> = {}
  for (const field of resolved?.required ?? []) {
    const fieldSchema = derefSchema(resolved?.properties?.[field])
    result[field] = depth > 0 && isObjectSchema(fieldSchema) ? buildExample(fieldSchema, depth - 1) : typeDefault(fieldSchema)
  }
  return result
}

function bodySchemaOf(op: Operation): OpenApiSchema | undefined {
  const content = op.requestBody?.content
  if (content === undefined) return undefined
  return content['application/json']?.schema ?? Object.values(content)[0]?.schema
}

function exampleBodyText(op: Operation): string {
  return JSON.stringify(buildExample(bodySchemaOf(op), 1), null, 2)
}

function buildEndpoint(method: HttpMethod, path: string, op: Operation): Endpoint {
  const hasBody = op.requestBody !== undefined
  return {
    method,
    path,
    displayPath: displayPathOf(path),
    tag: op.tags?.[0] ?? 'Other',
    hasBody,
    bodyExample: hasBody ? exampleBodyText(op) : '',
  }
}

/** Endpunktkatalog aus dem gebündelten Contract, gruppiert nach Tags (Tag-Reihenfolge aus dem Dokument). */
export function listEndpointGroups(): EndpointGroup[] {
  const byTag = new Map<string, Endpoint[]>()
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [rawMethod, op] of Object.entries(operations)) {
      const method = rawMethod.toUpperCase() as HttpMethod
      if (!METHODS.includes(method)) continue
      const endpoint = buildEndpoint(method, path, op)
      const list = byTag.get(endpoint.tag)
      if (list) list.push(endpoint)
      else byTag.set(endpoint.tag, [endpoint])
    }
  }

  const declaredOrder = doc.tags?.map((tag) => tag.name) ?? []
  const orderedTags = [...declaredOrder, ...byTag.keys()].filter((tag, index, all) => byTag.has(tag) && all.indexOf(tag) === index)
  return orderedTags.map((tag) => ({ tag, endpoints: byTag.get(tag)! }))
}
