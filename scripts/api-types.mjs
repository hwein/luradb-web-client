import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const targetJsonPath = path.join(rootDir, 'src', 'api', 'openapi.json')
const targetSchemaPath = path.join(rootDir, 'src', 'api', 'schema.d.ts')

// Contract source is the LuraDB repo: client `main` follows LuraDB `main`
// (released), client `next` follows `next` (in progress). Override the ref by
// arg or env (also a tag/commit to pin): npm run api:types -- next
const ref = process.argv[2] ?? process.env.LURADB_API_REF ?? 'main'
const url = `https://raw.githubusercontent.com/hwein/luradb/${ref}/api/openapi.json`

// api/openapi.json repeats the list/create/get/delete_domain operationIds per engine
// (generic + json + rel); make them unique in memory for codegen only, so Redocly's
// operation-operationId-unique check does not abort. The committed copy
// (src/api/openapi.json) stays unchanged.
function dedupeOperationIds(schema) {
  const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
  const seen = new Map()
  for (const [pathKey, pathItem] of Object.entries(schema.paths ?? {})) {
    for (const method of methods) {
      const operation = pathItem?.[method]
      const id = operation?.operationId
      if (!id) continue
      const count = seen.get(id) ?? 0
      seen.set(id, count + 1)
      if (count > 0) {
        const segment = pathKey.split('/').find((part) => part && part !== 'store-api') ?? 'op'
        operation.operationId = `${segment}_${id}_${count}`
      }
    }
  }
}

const response = await fetch(url)

// exitCode instead of exiting directly: exiting right after fetch aborts node on Windows.
if (!response.ok) {
  console.error(`api:types: fetch ${url} → HTTP ${response.status}. Bad ref '${ref}' (main/next/tag)?`)
  process.exitCode = 1
} else {
  const source = await response.text()
  writeFileSync(targetJsonPath, source)

  const schema = JSON.parse(source)
  dedupeOperationIds(schema)
  const ast = await openapiTS(schema)
  writeFileSync(targetSchemaPath, `${COMMENT_HEADER}${astToString(ast)}`)

  console.log(`api:types: Contract ${schema.info.version} @ luradb/${ref} → src/api/openapi.json + src/api/schema.d.ts`)
}
