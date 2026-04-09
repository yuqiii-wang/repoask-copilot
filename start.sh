#!/bin/bash

python -m pip install -r requirements.txt

# Build extension
cd repo-ask
npm install
npm run compile
npx vsce package --allow-missing-repository

# Start servers (on ports 8091, 8092, 8093 and 8094)
cd dummy-servers
# Kill processes on ports 8091, 8092, 8093 and 8094
for port in 8091 8092 8093 8094; do
    pids=$(lsof -t -i:$port 2>/dev/null)
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done

# python -m pip install -r requirements.txt
nohup python confluence_server.py &
nohup python jira_server.py &
nohup python logtail_server.py &
nohup python fileexplorer_server.py logs &


