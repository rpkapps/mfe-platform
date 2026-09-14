import type { StandardSchemaV1 } from '@standard-schema/spec'
import { PlatformError } from './errors'

/** Any Standard Schema v1 object (Zod, Valibot, ArkType, …). The platform ships no validation library (§9.1). */
export type Schema<T = unknown> = StandardSchemaV1<unknown, T>
export type InferOutput<S> = S extends Schema<infer T> ? T : never

/** Validates synchronously. Async schemas are rejected: trust-boundary validation must not defer (§9.1). */
export function validate<T>(schema: Schema<T>, value: unknown, where: string): T {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) {
    throw new PlatformError('core/unsupported', `${where}: asynchronous schemas are not supported`)
  }
  if (result.issues) {
    throw new PlatformError('core/invalid-input', `${where}: invalid value`, {
      details: { issues: result.issues.map(i => ({ message: i.message, path: i.path?.map(p => (typeof p === 'object' ? p.key : p)) })) },
    })
  }
  return result.value
}
