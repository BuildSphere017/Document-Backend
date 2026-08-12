export class ApiError extends Error {
  statusCode: number
  details?: unknown

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message)
    this.statusCode = statusCode
    this.details = details
    Object.setPrototypeOf(this, ApiError.prototype)
  }

  static badRequest(msg = "Bad request", details?: unknown) {
    return new ApiError(400, msg, details)
  }
  static unauthorized(msg = "Unauthorized") {
    return new ApiError(401, msg)
  }
  static forbidden(msg = "Forbidden") {
    return new ApiError(403, msg)
  }
  static notFound(msg = "Not found") {
    return new ApiError(404, msg)
  }
  static conflict(msg = "Conflict", details?: unknown) {
    return new ApiError(409, msg, details)
  }
  static internal(msg = "Internal server error") {
    return new ApiError(500, msg)
  }
}
