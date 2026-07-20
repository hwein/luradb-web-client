import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const targetJsonPath = path.join(rootDir, 'src', 'api', 'openapi.json')
const targetSchemaPath = path.join(rootDir, 'src', 'api', 'schema.d.ts')

// Contract-Quelle ist das LuraDB-Repo: Client-`main` bindet an LuraDB-`main`
// (released), Client-`next` an `next` (in Arbeit). Ref via Arg oder Env
// uebersteuerbar (auch Tag/Commit zum Pinnen): npm run api:types -- next
const ref = process.argv[2] ?? process.env.LURADB_API_REF ?? 'main'
const url = `https://raw.githubusercontent.com/hwein/luradb/${ref}/api/openapi.json`

const response = await fetch(url)
if (!response.ok) {
  console.error(`api:types: fetch ${url} → HTTP ${response.status}. Ref '${ref}' korrekt (main/next/tag)?`)
  process.exit(1)
}
const source = await response.text()
writeFileSync(targetJsonPath, source)

// api/openapi.json wiederholt list/create/get/delete_domain-operationIds je Engine
// (generisch + json + rel) – nur fuers Codegen in-memory eindeutig machen, damit
// Redoclys operation-operationId-unique-Check nicht abbricht. Die committete Kopie
// (src/api/openapi.json) bleibt unveraendert.
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

const schema = JSON.parse(source)
dedupeOperationIds(schema)
const ast = await openapiTS(schema)
writeFileSync(targetSchemaPath, `${COMMENT_HEADER}${astToString(ast)}`)

console.log(`api:types: Contract ${schema.info.version} @ luradb/${ref} → src/api/openapi.json + src/api/schema.d.ts`)
