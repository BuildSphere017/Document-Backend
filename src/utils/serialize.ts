/**
 * Prisma returns BigInt for byte-size columns, which JSON.stringify can't handle.
 * This recursively converts BigInt → number so responses serialize cleanly.
 */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v))
  )
}
