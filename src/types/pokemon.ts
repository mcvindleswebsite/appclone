export type StockState = "in_stock" | "sold_out" | "queue" | "blocked" | "unknown";

export interface CheckResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  stock: StockState;
  error?: string;
}
