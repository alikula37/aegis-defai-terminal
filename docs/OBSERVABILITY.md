# Gözlemlenebilirlik (Phase 4 — D8)

Ajan davranışı iki kaynaktan izlenir:

1. **prom-client metrikleri** — `/metrics` uç noktası (zaten mevcut, Faz 2/3).
2. **OpenTelemetry span'leri** — ajan döngüsü, LLM çağrıları ve onchain
   yürütme; `OTEL_ENABLED=true` ile açılır ve span örnekleri doğrudan **aynı
   prom-client registry'sine** düşer (harici OTLP/Jaeger kollektörü gerekmez).

## Etkinleştirme

```bash
# backend/.env
OTEL_ENABLED="true"
```

Kapalıyken (varsayılan) `trace()` tamamen no-op'tur: zero overhead, hiçbir
enstrümantasyon nesnesi oluşturulmaz.

## Metrikler

`GET http://localhost:3001/metrics`

| Metrik | Tip | Açıklama |
|---|---|---|
| `aegis_http_requests_total` | counter | HTTP istekleri {method, route, status} |
| `aegis_http_duration_seconds` | histogram | HTTP süresi {method, route} |
| `aegis_ws_clients` | gauge | Bağlı WS istemcisi sayısı |
| `aegis_portfolio_tvl` | gauge | Son portföy TVL (USD) |
| `aegis_agent_running` | gauge | Ajan cycle çalışıyor mu (1/0) |
| `aegis_llm_calls_total` | counter | LLM çağrıları {model, kind} |
| `aegis_llm_calls_per_cycle` | gauge | Döngüdeki LLM çağrısı |
| `aegis_tool_calls_total` | counter | Read-only araç çağrıları {tool, status} |
| `aegis_tool_call_duration_seconds` | histogram | Araç süresi {tool} |
| `aegis_spans_total` | counter | OTel span'leri {name, status} (ok/error) |
| `aegis_span_duration_seconds` | histogram | OTel span süresi {name} |

## Span'ler

`monitoring/tracing.js` → `trace(name, fn, attributes)`:

- `aegis.cycle` — bir ajan döngüsünün tamamı (decision attribute'u dahil).
  `agent.js` `runCycle` içinde.
- `aegis.llm` — OpenRouter chat completion çağrısı (model attribute'u).
  `services/LLMService.js` `fetchChatCompletion` içinde (hata durumunda
  `status="error"` + exception).
- `aegis.onchain` — plan yürütme (steps + decision attribute'ları).
  `execution/OnchainExecution.js` `_executePlan` içinde.

Span'ler `SimpleSpanProcessor` ile bittiğinde anında exporter'a düşer (test
edilebilirlik ve canlı dashboard için idealdir). Status kuralı: OTel ERROR
kodu (2) → `aegis_spans_total{status="error"}`.

## Grafana

Örnek dashboard: `docs/grafana/aegis-dashboard.json`.

1. Grafana → Data sources → Prometheus → `http://<host>:9090`.
2. Dashboards → Import → `aegis-dashboard.json`.
3. Paneller: agent durumu, TVL, HTTP istek hızı, LLM/araç çağrıları,
   span gecikmesi (`aegis_span_duration_seconds`) ve hata oranı
   (`aegis_spans_total{status="error"}`).

## Test

`__tests__/tracing.test.js` — no-op passthrough, span→registry akışı, hata
status'ü, registry değişimi. Testler izole `Registry` kullanır; gerçek /metrics
etkilenmez.

## Risk / notlar

- OTel SDK v2: processor'lar provider constructor'ından
  (`spanProcessors: [SimpleSpanProcessor]`) verilir — `addSpanProcessor` v2'de
  yoktur.
- `OTEL_ENABLED` açıkken bile trace yokluğunda kod aynı davranır
  (`trace()` her iki modda da callback sonucunu döndürür, hataları yeniden fırlatır).
