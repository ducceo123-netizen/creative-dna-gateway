export interface RouteItem {
  brand: string;
  title: string;
  branch: string;
  version: string;
  node_type: string;
}

export interface RoutesResponse {
  api_version?: string;
  mode?: string;
  routes?: RouteItem[];
  [key: string]: any;
}

export interface HealthResponse {
  status: string;
  mode: string;
  upstream: string;
  upstreamStatus?: number;
  latencyMs: number;
  timestamp: string;
  message?: string;
}

export interface QueryMeta {
  action: "resolve" | "routes" | "health";
  timestamp: string;
  durationMs: number;
  status: number;
  ok: boolean;
}
