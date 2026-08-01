const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createId(prefix: "usr" | "fam" | "fmem" | "inv" | "ired" | "evt" | "tsk" | "sys" | "crd" | "day" | "dyo"): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function createInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const value = Array.from(bytes, (byte) => inviteAlphabet[byte % inviteAlphabet.length]).join("");
  return `HM-${value.slice(0, 4)}-${value.slice(4)}`;
}
