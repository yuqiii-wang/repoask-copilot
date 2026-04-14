# Minimalist Loki Server with Docker

This directory contains a minimal Loki log aggregation setup using Docker Compose.

## Components

- **Loki**: Log aggregation system (port 8094)
- **Promtail**: Log shipper that tails log files from `../logs/` directory
- **Grafana**: Web UI for querying and visualizing logs (port 3000)

## Quick Start

### Start the Stack

```bash
cd dummy-servers/loki_server
docker-compose up -d
```

### Access the Services

- **Grafana**: http://localhost:3000
  - Pre-configured with Loki datasource
  - Anonymous access enabled (no login required)
  
- **Loki API**: http://localhost:8094
  - Health check: http://localhost:8094/ready
  - Metrics: http://localhost:8094/metrics

### Query Logs

#### Using Grafana
1. Open http://localhost:3000
2. Go to "Explore" in the left menu
3. Use LogQL queries like:
   - `{job="app-logs"}` - All logs
   - `{job="app-logs"} |= "ERROR"` - Filter for ERROR logs
   - `{job="app-logs", level="ERROR"}` - Filter by log level label

#### Using Loki API

Query logs via HTTP:
```bash
# Get all recent logs
curl -G -s "http://localhost:8094/loki/api/v1/query_range" \
  --data-urlencode 'query={job="app-logs"}' \
  --data-urlencode 'limit=100' | jq

# Query with time range
curl -G -s "http://localhost:8094/loki/api/v1/query_range" \
  --data-urlencode 'query={job="app-logs"} |= "ERROR"' \
  --data-urlencode 'start=2026-04-01T00:00:00Z' \
  --data-urlencode 'end=2026-04-10T23:59:59Z' | jq
```

### View Container Logs

```bash
# View Loki logs
docker-compose logs -f loki

# View Promtail logs
docker-compose logs -f promtail

# View Grafana logs
docker-compose logs -f grafana
```

### Stop the Stack

```bash
docker-compose down
```

### Stop and Remove Data

```bash
docker-compose down -v
```

## Log File Format

Promtail is configured to tail log files from `../logs/` directory. The expected log format is:

```
2026-04-01 08:45:23.456 INFO This is a log message
2026-04-01 08:45:24.789 ERROR An error occurred
```

Format: `YYYY-MM-DD HH:MM:SS.mmm LEVEL MESSAGE`

## Configuration Files

- `docker-compose.yml` - Docker Compose configuration
- `loki-config.yaml` - Loki server configuration
- `promtail-config.yaml` - Promtail log shipper configuration
- `grafana-datasources.yaml` - Grafana datasource provisioning

## Troubleshooting

### Logs Not Appearing in Loki

Common causes:
1. **Promtail only tails new log lines** - existing log content won't be ingested automatically
2. **Log format mismatch** - check regex patterns in `promtail-config.yaml`
3. **Component labels missing** - verify scrape configs match your log file patterns

### Manual Log Ingestion (Static Files)

For static/historical log files, use the manual ingestion script:

```bash
# Clear old data
docker-compose down -v
docker-compose up -d
sleep 5

# Ingest logs via Python script
python ingest_logs.py
```

The `ingest_logs.py` script:
- Scans `../logs/` for log files
- Parses timestamps from each line
- Pushes to Loki via HTTP API
- Required when Promtail can't re-read existing files

### "Entry too far behind" Errors

Loki rejects old timestamps once a stream exists. To fix:

```bash
# Clear all data and restart
docker-compose down -v
docker-compose up -d
sleep 5

# Re-ingest from scratch
python ingest_logs.py
```

### Empty Query Results

If ingestion succeeds but queries return no data:
1. **Check labels**: `curl http://localhost:8094/loki/api/v1/labels`
2. **Check components**: `curl http://localhost:8094/loki/api/v1/label/component/values`
3. **Verify time range** matches log timestamps
4. **Check series**: `curl -G http://localhost:8094/loki/api/v1/series --data-urlencode 'match[]={component="trading-system"}'`

### Container Health Checks

```bash
# Check container status
docker-compose ps

# View recent logs
docker logs loki --tail 50
docker logs promtail --tail 50

# Test Loki API
curl http://localhost:8094/ready
curl http://localhost:8094/loki/api/v1/labels
```

## Production Support Integration

The production support system uses **Logtail mode by default** (simpler HTTP API on port 8093).

To enable **Loki mode** with LogQL queries:
1. Manually ingest logs using `python ingest_logs.py`
2. Edit `repo-ask/src/extension/chat/productionSupportChat.ts`
3. Uncomment the Loki ingestion block
4. Add `--loki --loki-url http://localhost:8094` to main.py args
5. Rebuild: `cd repo-ask && npm run compile`

**Note**: For local development with static logs, Logtail mode is recommended as it works immediately without ingestion steps.

### Logs not appearing in Loki

1. Check Promtail is reading the files:
   ```bash
   docker-compose logs promtail
   ```

2. Verify log file permissions (should be readable)

3. Check Promtail targets:
   ```bash
   curl http://localhost:9080/targets
   ```

### Can't connect to Grafana

- Ensure port 3000 is not in use by another application
- Check Grafana logs: `docker-compose logs grafana`

### Loki not responding

- Check Loki logs: `docker-compose logs loki`
- Verify Loki is ready: `curl http://localhost:8094/ready`

## Resource Usage

This is a minimal configuration suitable for development/testing. For production use:
- Configure proper retention policies
- Add authentication
- Scale Loki horizontally
- Use external storage backends (S3, GCS, etc.)
