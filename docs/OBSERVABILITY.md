# Monitoring / İzleme

> **English · Türkçe**

## English

Aegis exposes Prometheus-compatible metrics and an optional Grafana dashboard,
so you can watch the agent from outside the web UI.

### Metrics endpoint

```
GET http://localhost:3001/metrics
```

| Metric | Type | Description |
|---|---|---|
| `aegis_http_requests_total` | counter | HTTP requests by {method, route, status} |
| `aegis_http_duration_seconds` | histogram | HTTP duration by {method, route} |
| `aegis_ws_clients` | gauge | Connected WebSocket clients |
| `aegis_portfolio_tvl` | gauge | Latest portfolio TVL (USD) |
| `aegis_agent_running` | gauge | Is the agent cycle running (1/0) |
| `aegis_llm_calls_total` | counter | LLM calls by {model, kind} |
| `aegis_llm_calls_per_cycle` | gauge | LLM calls in the current cycle |
| `aegis_tool_calls_total` | counter | Tool calls by {tool, status} |
| `aegis_tool_call_duration_seconds` | histogram | Tool duration by {tool} |
| `aegis_spans_total` | counter | OpenTelemetry spans by {name, status} |
| `aegis_span_duration_seconds` | histogram | Span duration by {name} |

### OpenTelemetry spans (optional)

With `OTEL_ENABLED=true` in `backend/.env`, the agent records spans for the
**agent cycle**, **LLM calls** and **on-chain execution** directly into the same
Prometheus registry (no external collector needed). When disabled (default)
tracing is a no-op with zero overhead.

### Grafana

1. Grafana → Data sources → Prometheus → `http://<host>:9090`.
2. Dashboards → Import → `docs/grafana/aegis-dashboard.json`.
3. Panels cover agent status, TVL, HTTP request rate, LLM/tool calls, span
   latency and error rate.

---

## Türkçe

Aegis, Prometheus uyumlu metrikler ve isteğe bağlı bir Grafana paneli sunar —
ajanı web arayüzü dışından da izleyebilirsiniz.

### Metrik uç noktası

```
GET http://localhost:3001/metrics
```

| Metrik | Tip | Açıklama |
|---|---|---|
| `aegis_http_requests_total` | counter | HTTP istekleri {method, route, status} |
| `aegis_http_duration_seconds` | histogram | HTTP süresi {method, route} |
| `aegis_ws_clients` | gauge | Bağlı WebSocket istemcisi sayısı |
| `aegis_portfolio_tvl` | gauge | Son portföy TVL (USD) |
| `aegis_agent_running` | gauge | Ajan cycle çalışıyor mu (1/0) |
| `aegis_llm_calls_total` | counter | LLM çağrıları {model, kind} |
| `aegis_llm_calls_per_cycle` | gauge | Mevcut döngüdeki LLM çağrısı |
| `aegis_tool_calls_total` | counter | Araç çağrıları {tool, status} |
| `aegis_tool_call_duration_seconds` | histogram | Araç süresi {tool} |
| `aegis_spans_total` | counter | OpenTelemetry span'leri {name, status} |
| `aegis_span_duration_seconds` | histogram | Span süresi {name} |

### OpenTelemetry span'leri (opsiyonel)

`backend/.env` içinde `OTEL_ENABLED=true` ile ajan; **ajan döngüsü**, **LLM
çağrıları** ve **onchain yürütme** için span'leri doğrudan aynı Prometheus
registry'sine yazar (harici toplayıcı gerekmez). Kapalıyken (varsayılan) izleme
tamamen no-op'tur: sıfır yük.

### Grafana

1. Grafana → Data sources → Prometheus → `http://<host>:9090`.
2. Dashboards → Import → `docs/grafana/aegis-dashboard.json`.
3. Paneller: ajan durumu, TVL, HTTP istek hızı, LLM/araç çağrıları, span
   gecikmesi ve hata oranı.