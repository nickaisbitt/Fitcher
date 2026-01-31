const HistoricalDataService = require('../src/services/historicalDataService');
const BacktestEngine = require('../src/services/backtestEngine');
const strategyFactory = require('../src/strategies/strategyFactory');

async function run() {
  const exchange = process.env.BACKTEST_EXCHANGE || 'kraken';
  const pair = process.env.BACKTEST_PAIR || 'BTC/USD';
  const timeframe = process.env.BACKTEST_TIMEFRAME || '1h';
  const limit = parseInt(process.env.BACKTEST_LIMIT || '300', 10);
  const strategyType = process.env.BACKTEST_STRATEGY || 'mean_reversion';

  const historicalService = new HistoricalDataService();
  const rawData = await historicalService.fetchOHLCV(
    exchange,
    pair,
    timeframe,
    null,
    limit
  );

  if (!rawData || rawData.length === 0) {
    throw new Error('No historical data returned');
  }

  const normalizedPair = pair.toUpperCase().replace('-', '/');
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

  const results = await backtest.run(strategy, historicalData, { enableLogging: false });

  const summary = results.summary;
  console.log('Backtest Summary');
  console.log('----------------');
  console.log(`Strategy: ${strategyType}`);
  console.log(`Pair: ${pair} (${timeframe})`);
  console.log(`Data points: ${historicalData.length}`);
  console.log(`Initial balance: $${summary.initialBalance.toFixed(2)}`);
  console.log(`Final balance: $${summary.finalBalance.toFixed(2)}`);
  console.log(`Total return: ${summary.totalReturn.toFixed(2)}%`);
  console.log(`Total trades: ${summary.totalTrades}`);
  console.log(`Win rate: ${summary.winRate.toFixed(2)}%`);
  console.log(`Max drawdown: ${summary.maxDrawdownPercent.toFixed(2)}%`);
  console.log(`Sharpe ratio: ${summary.sharpeRatio.toFixed(2)}`);
}

run().catch((error) => {
  console.error('Backtest failed:', error.message);
  process.exit(1);
});
