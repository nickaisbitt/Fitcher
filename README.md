# Kraken AI Trading Bot

AI-powered cryptocurrency trading bot with multi-exchange support.

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

## Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

```bash
npm install
npm start
```

## Files

- `index.html` - Main trading bot (standalone, no build required)
- `kraken-trading-bot.jsx` - Source JSX file
- `build.py` - Build script to regenerate index.html

## License

MIT
