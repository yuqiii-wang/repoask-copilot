#!/bin/bash

python -m pip install -r requirements.txt

# Build extension
pushd repo-ask
npm install
npm run compile
npx vsce package --allow-missing-repository
popd


# Start servers (on ports 8091, 8092, 8093, and 8094)
pushd dummy-servers
# Kill processes on ports 8091, 8092, 8093, and 8094
for port in 8091 8092 8093 8094; do
    pids=$(lsof -t -i:$port 2>/dev/null)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done

# python -m pip install -r requirements.txt
nohup python confluence_server.py &
nohup python jira_server.py &
nohup python logtail_server.py &
popd

## if on docker
pushd dummy-servers/loki_server
docker-compose down
docker-compose up -d
popd

pushd dummy-servers/dummy-trading-system
rm -f logs/*.log logs/*.log.gz
kill -9 $(lsof -t -i:8080 2>/dev/null) 2>/dev/null || true
nohup mvn spring-boot:run -q > /tmp/trading-system-server.log 2>&1 &
until lsof -t -i:8080 >/dev/null 2>&1; do sleep 1; done
mvn test -Dtest=CucumberTest
popd

# Ingest trading system logs into Loki after tests complete
pushd dummy-servers/loki_server
python ingest_logs.py
popd
