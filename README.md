# Fitcher

<p align="center">
  <img src="logo.svg" alt="Fitcher Logo" width="120" height="120">
</p>

<p align="center">
  <strong>AI-Powered Crypto Trading</strong><br>
  <em>Modern Nordic Design • Multi-Exchange • Intelligent Analysis</em>
</p>

---

## Features

- **Multi-Exchange Support**: Kraken, Binance, Coinbase
- **AI Analysis**: OpenRouter integration (Claude, GPT-4, Gemini, Llama)
- **Advanced Strategies**: Kelly Criterion, Pyramiding, Turtle Trading
- **Risk Management**: Circuit breakers, position sizing, trailing stops
- **Technical Analysis**: RSI, MACD, Bollinger Bands, support/resistance
- **Monte Carlo Simulation**: Statistical backtesting validation
- **News Sentiment**: Real-time crypto news analysis
- **Fear & Greed Index**: Market sentiment tracking

## Quick Start

1. Open `index.html` in your browser
2. Select your exchange (Kraken/Binance/Coinbase)
3. Click "Connect" to start receiving real-time prices
4. (Optional) Add your OpenRouter API key for AI analysis

## Deploy

### Railway
```bash
npm install
npm start
```

### Local Development
```bash
python3 build.py  # Rebuild index.html from JSX
npx serve .       # Serve locally
```

## Backtesting API

All backtest endpoints require a JWT access token.

### Run a backtest
```bash
curl -X POST http://localhost:3000/api/backtest/run \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "kraken",
    "pair": "BTC/USD",
    "timeframe": "1h",
    "limit": 300,
    "strategyType": "mean_reversion",
    "strategyParams": {
      "bbPeriod": 20,
      "bbStdDev": 2,
      "rsiPeriod": 14,
      "rsiOverbought": 70,
      "rsiOversold": 30
    },
    "backtestConfig": {
      "initialBalance": 10000,
      "slippageModel": "fixed",
      "slippageBps": 5,
      "takerFee": 0.002
    }
  }'
```

### Run walk-forward optimization
```bash
curl -X POST http://localhost:3000/api/backtest/optimize \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "exchange": "kraken",
    "pair": "BTC/USD",
    "timeframe": "1h",
    "limit": 500,
    "strategyType": "mean_reversion",
    "backtestConfig": {
      "initialBalance": 10000
    }
  }'
```

### Fetch backtest history
```bash
curl -X GET "http://localhost:3000/api/backtest/history?type=RUN&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Fetch backtest history with filters
```bash
curl -X GET "http://localhost:3000/api/backtest/history?type=RUN&strategyType=mean_reversion&include=full&page=1&limit=25&from=2025-01-01&to=2025-12-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Fetch a single backtest by ID
```bash
curl -X GET "http://localhost:3000/api/backtest/history/RECORD_ID?include=full" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Historical Data Ingestion API

### Pre-fetch common datasets (BTC/USD, ETH/USD from 2020)
```bash
curl -X POST http://localhost:3000/api/data/prefetch \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Trigger custom data ingestion
```bash
curl -X POST http://localhost:3000/api/data/ingest \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pairs": ["BTC/USD", "ETH/USD"],
    "timeframes": ["1h", "1d"],
    "startDate": "2020-01-01",
    "endDate": "2026-01-29",
    "async": true
  }'
```

### Check data availability status
```bash
curl -X GET http://localhost:3000/api/data/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Detect data gaps
```bash
curl -X GET "http://localhost:3000/api/data/gaps?pair=BTC/USD&timeframe=1h" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Repair data gaps
```bash
curl -X POST http://localhost:3000/api/data/repair \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pair": "BTC/USD",
    "timeframe": "1h"
  }'
```

### Read historical data from local storage
```bash
curl -X GET "http://localhost:3000/api/data/read?pair=BTC/USD&timeframe=1h&from=2025-01-01&to=2025-01-31&limit=1000" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| Nordic Dark | `#0D1B2A` | Background |
| Nordic Deep | `#1B2838` | Cards |
| Nordic Blue | `#4A90B8` | Accents |
| Nordic Pale | `#7FB3D3` | Primary |
| Nordic Ice | `#B8D4E8` | Highlights |
| Nordic Frost | `#E8F4FC` | Text |
| Nordic White | `#FFFFFF` | Headings |

## License

MIT
