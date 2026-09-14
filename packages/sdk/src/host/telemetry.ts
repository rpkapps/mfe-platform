import type { Observer } from '../observer'
import { createObserverStore } from '../observer'

export interface TelemetryRecord {
  type: string
  at: string
  [key: string]: unknown
}

export type TelemetryWriter = (record: TelemetryRecord) => void

export function createTelemetry(write?: TelemetryWriter) {
  const records: TelemetryRecord[] = []
  const changes = createObserverStore(0)
  return {
    emit(type: string, data: Record<string, unknown> = {}) {
      const record: TelemetryRecord = { type, at: new Date().toISOString(), ...data }
      records.push(record)
      if (records.length > 5000) records.splice(0, records.length - 5000)
      write?.(record)
      changes.set(changes.get() + 1)
    },
    records: () => records.slice(),
    /** Ticks on every record; DevTools subscribes to it. */
    changes: changes as Observer<number>,
  }
}
export type Telemetry = ReturnType<typeof createTelemetry>
