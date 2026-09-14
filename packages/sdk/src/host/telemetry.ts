export interface TelemetryRecord {
  type: string
  at: string
  [key: string]: unknown
}

export type TelemetryWriter = (record: TelemetryRecord) => void

export function createTelemetry(write?: TelemetryWriter) {
  const records: TelemetryRecord[] = []
  return {
    emit(type: string, data: Record<string, unknown> = {}) {
      const record: TelemetryRecord = { type, at: new Date().toISOString(), ...data }
      records.push(record)
      if (records.length > 5000) records.splice(0, records.length - 5000)
      write?.(record)
    },
    records: () => records.slice(),
  }
}
export type Telemetry = ReturnType<typeof createTelemetry>
