const SQLITE_UTC = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/;

export function nowUtc(): string {
  return new Date().toISOString();
}

export function toUtcIso(value: string): string {
  const normalized = value.replace(SQLITE_UTC, "$1T$2Z");
  const instant = new Date(normalized);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Stored date-time is invalid");
  }
  return instant.toISOString();
}

export function zonedMidnightUtc(date: string, timeZone: string): string {
  let instant = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    instant = new Date(
      instant.getTime() + Date.parse(`${date}T00:00:00Z`) - represented,
    );
  }
  return instant.toISOString();
}

export function normalizeDateTimes<T>(value: T, key?: string): T {
  if (typeof value === "string" && key?.endsWith("At")) {
    return toUtcIso(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDateTimes(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalizeDateTimes(child, childKey),
      ]),
    ) as T;
  }
  return value;
}
