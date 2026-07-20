export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
