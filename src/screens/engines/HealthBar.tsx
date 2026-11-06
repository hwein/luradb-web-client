import { formatBytes } from '../../lib'
import type { HealthSnapshot, ResourceLevel } from './health'
import type { MetricsResources } from './metrics'

interface HealthBarProps {
  health: HealthSnapshot
  /** Admin numbers from /store-api/metrics; undefined for non-admins or before the first answer. */
  resources: MetricsResources | undefined
  metricsUnavailable: boolean
}

function levelTone(level: ResourceLevel): string {
  return level === 'ok' ? '' : level === 'blocked' ? ' engines__health-seg--err' : ' engines__health-seg--warn'
}

/** Server state strip below the SYSTEM bar. */
export function HealthBar({ health, resources, metricsUnavailable }: HealthBarProps) {
  const { shards, resources: levels, ioFailures } = health
  const shardsOk = shards.filter((shard) => shard.status === 'ok').length
  const shardsTone = shardsOk === shards.length ? '' : ' engines__health-seg--err'
  const shardTitle = shards.map((shard) => `shard ${shard.id}: ${shard.status}`).join('\n')
  const shardsLabel = `shards ${shardsOk}/${shards.length} ok`
  const volumes = resources?.disk ?? []
  const memory = resources?.memory

  // Titled segments: role + aria-label keep the visible text as name, so `title` is only the description.
  return (
    <div className="engines__health">
      <span className={`engines__health-seg${shardsTone}`} role="group" aria-label={shardsLabel} title={shardTitle}>
        {shardsLabel}
      </span>
      <span className={`engines__health-seg${levelTone(levels.diskState)}`}>disk {levels.diskState}</span>
      {volumes.map((volume) => {
        const volumeLabel = `${formatBytes(volume.freeBytes)} free of ${formatBytes(volume.sizeBytes)}`
        return (
          <span key={volume.path} className="engines__health-seg" role="group" aria-label={volumeLabel} title={volume.path}>
            {volumeLabel}
          </span>
        )
      })}
      <span className={`engines__health-seg${levelTone(levels.memoryState)}`}>memory {levels.memoryState}</span>
      {memory && (
        <span className="engines__health-seg">
          {formatBytes(memory.rssBytes)} of {formatBytes(memory.budgetBytes)}
        </span>
      )}
      <span className={`engines__health-seg${ioFailures > 0 ? ' engines__health-seg--warn' : ''}`}>
        {ioFailures > 0 ? `i/o ${ioFailures} failures` : 'i/o ok'}
      </span>
      {metricsUnavailable && <span className="engines__health-seg engines__health-seg--warn">metrics unavailable</span>}
    </div>
  )
}
