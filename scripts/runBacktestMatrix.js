const HistoricalDataService = require('../src/services/historicalDataService');
const BacktestEngine = require('../src/services/backtestEngine');
const strategyFactory = require('../src/strategies/strategyFactory');

const DEFAULTS = {
  exchange: process.env.BACKTEST_EXCHANGE || 'kraken',
  pair: process.env.BACKTEST_PAIR || 'BTC/USD',
  strategies: (process.env.BACKTEST_STRATEGIES || 'mean_reversion,momentum,grid')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  timeframes: (process.env.BACKTEST_TIMEFRAMES || '1h,1d,1M')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean),
  limits: {
    '1h': parseInt(process.env.BACKTEST_LIMIT_1H || '300', 10),
    '1d': parseInt(process.env.BACKTEST_LIMIT_1D || '365', 10),
    '1M': parseInt(process.env.BACKTEST_LIMIT_1M || '120', 10)
  }
};

async function run() {
  const historicalService = new HistoricalDataService();
  const results = [];

  for (const timeframe of DEFAULTS.timeframes) {
    const limit = DEFAULTS.limits[timeframe] || 300;

    for (const strategyType of DEFAULTS.strategies) {
      try {
        const rawData = await historicalService.fetchOHLCV(
          DEFAULTS.exchange,
          DEFAULTS.pair,
          timeframe,
          null,
          limit
        );

        if (!rawData || rawData.length === 0) {
          results.push({
            strategy: strategyType,
            timeframe,
            status: 'no_data'
          });
          continue;
        }

        const normalizedPair = DEFAULTS.pair.toUpperCase().replace('-', '/');
        const historicalData = rawData.map(candle => ({
          ...candle,
          pair: normalizedPair
        }));

        const strategy = strategyFactory.create(strategyType, {});
        const backtest = new BacktestEngine({
          initialBalance: 10000,
          slippageModel: 'fixed',
          slippageBps: 5,
          takerFee: 0.002,
          makerFee: 0.001
        });

        const out = await backtest.run(strategy, historicalData, { enableLogging: false });
        const summary = out.summary;

        results.push({
          strategy: strategyType,
          timeframe,
          dataPoints: historicalData.length,
          returnPct: Number(summary.totalReturn.toFixed(2)),
          trades: summary.totalTrades,
          winRate: Number(summary.winRate.toFixed(2)),
          maxDD: Number(summary.maxDrawdownPercent.toFixed(2)),
          sharpe: Number(summary.sharpeRatio.toFixed(2)),
          status: 'ok'
        });
      } catch (error) {
        results.push({
          strategy: strategyType,
          timeframe,
          status: 'error',
          error: error.message
        });
      }
    }
  }

  console.log('Backtest Matrix Results');
  console.log('-----------------------');
  console.table(results);
}

run().catch((error) => {
  console.error('Backtest matrix failed:', error.message);
  process.exit(1);
});
