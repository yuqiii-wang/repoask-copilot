import json
import os

def generate_dummy_data():
    confluence_pages = {}
    jira_issues = {}

    topics = [
        {'title': 'Equities Trading Platform', 'desc': 'Documentation for Stock trading. Covers high-frequency trading (HFT) infrastructure, limit orders, market orders, and dark pool integrations.'},
        {'title': 'Fixed Income and Bonds', 'desc': 'System design for municipal, corporate, and government bonds. Features yield-to-maturity calculators, coupon rate tracking, and duration analysis.'},
        {'title': 'Foreign Exchange (FX) Engine', 'desc': 'FX currency pair trading engine. Handles real-time spot rates, forward contracts, currency swaps, and latency-sensitive market making.'},
        {'title': 'Derivatives and Options', 'desc': 'Architecture for futures, options, and swaps. Includes Black-Scholes pricing models, implied volatility engine, and margin requirement calculators.'},
        {'title': 'Risk Management System', 'desc': 'Real-time Value at Risk (VaR) monitoring, stress testing, counterparty credit risk limits, and exposure aggregation across all asset classes.'},
        {'title': 'Order Management System (OMS)', 'desc': 'Core OMS handling routing, execution algos (VWAP, TWAP), FIX protocol endpoints, and broker-dealer order flow.'},
        {'title': 'Ledger and Accounting', 'desc': 'Multi-currency general ledger. Handles daily PnL reconciliation, double-entry bookkeeping, and daily NAV calculations calculation logic.'},
        {'title': 'Market Data Feeds', 'desc': 'Low-latency market data ingestion from Bloomberg, Reuters, and direct exchange feeds (e.g., NASDAQ ITCH, CME MDP).'},
        {'title': 'Algorithmic Trading Execution', 'desc': 'Quantitative model execution environment. Includes backtesting framework, historical tick data storage, and strategy deployment rules.'},
        {'title': 'Settlement and Clearing', 'desc': 'Post-trade lifecycle. T+1 and T+2 settlement, SWIFT messaging integration, DTC/NSCC clearing, and failed trade resolution workflows.'}
    ]

    # Generate 10 Confluence Pages
    for i, topic in enumerate(topics, 1):
        page_id = str(77778880 + i)
        title = topic['title']
        desc = topic['desc']
        confluence_pages[page_id] = {
            'id': page_id,
            'type': 'page',
            'status': 'current',
            'title': f'PROJ: {title}',
            'body': {
                'storage': {
                    'value': f'<div><h1>{title}</h1><p>{desc}</p><ul><li>Architecture Overview</li><li>API Endpoints</li></ul></div>',
                    'representation': 'storage'
                }
            },
            '_links': {
                'webui': f"/spaces/PROJ/pages/{page_id}/{title.replace(' ', '+')}"
            }
        }

    # Generate 10 Jira Issues
    for i, topic in enumerate(topics, 1):
        issue_id = str(10000 + i)
        issue_key = f'PROJ-{i}'
        title = topic['title']
        desc = topic['desc']
        jira_issues[issue_key] = {
            'id': issue_id,
            'key': issue_key,
            'fields': {
                'summary': f'Implement {title}',
                'description': f'<div><h3>Task: {title}</h3><p>{desc}</p><p>Requires urgent implementation for the Q3 release.</p></div>'
            }
        }

    data = {
        'confluence': confluence_pages,
        'jira': jira_issues
    }

    output_path = os.path.join(os.path.dirname(__file__), 'dummy_data.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)
    print(f'Generated dummy data successfully to {output_path}')

if __name__ == '__main__':
    generate_dummy_data()

