export function success<T>(data: T): { data: T } {
  return { data };
}

export function failure(
  code: string,
  message: string,
  requestId: string,
): {
  error: { code: string; message: string; requestId: string };
} {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}
