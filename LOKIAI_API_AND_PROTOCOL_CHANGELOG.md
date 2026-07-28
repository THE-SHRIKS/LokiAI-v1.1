# LokiAI API and Protocol Changelog

## 2026-07-28
- **`GET /api/models/{repo_id}` API:** The backend now reliably traverses paginated Hugging Face repositories using the `/tree/main` endpoint if the primary metadata array omits the `siblings` block. Direct URL searches now execute the identical pipeline as generic search.
- **Client Side Status Polling:** Monitor routes (`/monitor/log`, `/monitor/status`) returning 401/403/404 are now strictly honored by the frontend. Polling loops immediately self-terminate upon receiving access denial, reducing server load.
