const logger = require('../utils/logger');

/**
 * SmartOrderRouter - Intelligent order execution
 * Determines optimal order type and parameters based on market conditions
 */
class SmartOrderRouter {
  constructor(options = {}) {
    this.config = {
      // Order type thresholds
      largeOrderThreshold: options.largeOrderThreshold || 10000, // USD
      highVolatilityThreshold: options.highVolatilityThreshold || 0.05, // 5%
      
      // Limit order settings
      limitOffsetDefault: options.limitOffsetDefault || 0.0015, // 0.15%
      limitOffsetHighVol: options.limitOffsetHighVol || 0.005, // 0.5%
      
      // TWAP settings
      twapDuration: options.twapDuration || 300000, // 5 minutes
      twapSlices: options.twapSlices || 5,
      
      // Urgency thresholds
      urgentTimeframe: options.urgentTimeframe || 60000, // 60 seconds
      
      // Slippage tolerance
      maxSlippage: options.maxSlippage || 0.005, // 0.5%
      
      ...options
    };
    
    this.priceFeed = null;
  }

  /**
   * Set price feed for market data
   */
  setPriceFeed(priceFeed) {
    this.priceFeed = priceFeed;
  }

  /**
   * Main execution method - determines optimal order strategy
   * @param {Object} signal - Trading signal
   * @param {Object} marketData - Current market conditions
   * @returns {Object} Optimized order parameters
   */
  async routeOrder(signal, marketData = {}) {
    try {
      logger.info(`Routing order for ${signal.pair}: ${signal.side}`);
      
      // Analyze market conditions
      const analysis = await this.analyzeMarketConditions(signal.pair, marketData);
      
      // Select order type
      const orderType = this.selectOrderType(signal, analysis);
      
      // Optimize parameters
      const optimizedOrder = this.optimizeOrderParameters(signal, orderType, analysis);
      
      // Calculate risk metrics
      const riskMetrics = this.calculateRiskMetrics(optimizedOrder, analysis);
      
      logger.info(`Order routed: ${orderType.type} @ ${optimizedOrder.price || 'market'}`);
      
      return {
        ...optimizedOrder,
        orderType: orderType.type,
        executionStrategy: orderType.strategy,
        riskMetrics,
        analysis: {
          volatility: analysis.volatility,
          liquidity: analysis.liquidity,
          spread: analysis.spread,
          urgency: analysis.urgency
        }
      };
      
    } catch (error) {
      logger.error('Order routing failed:', error);
      // Fallback to safe market order
      return this.createFallbackOrder(signal);
    }
  }

  /**
   * Analyze market conditions
   */
  async analyzeMarketConditions(pair, marketData) {
    const analysis = {
      timestamp: Date.now(),
      volatility: marketData.volatility || await this.calculateVolatility(pair),
      liquidity: marketData.liquidity || await this.assessLiquidity(pair),
      spread: marketData.spread || await this.getSpread(pair),
      volume24h: marketData.volume24h || 0,
      urgency: this.assessUrgency(marketData)
    };
    
    // Calculate composite scores
    analysis.volatilityScore = this.scoreVolatility(analysis.volatility);
    analysis.liquidityScore = this.scoreLiquidity(analysis.liquidity);
    analysis.overallScore = (analysis.liquidityScore * 0.6) + ((1 - analysis.volatilityScore) * 0.4);
    
    return analysis;
  }

  /**
   * Select best order type based on signal and market conditions
   */
  selectOrderType(signal, analysis) {
    const orderValue = signal.amount * (signal.price || signal.currentPrice);
    
    // Decision tree for order type selection
    
    // 1. Urgent orders (stop losses, high confidence signals)
    if (signal.urgency === 'high' || analysis.urgency === 'high') {
      return {
        type: 'market',
        strategy: 'immediate_execution',
        reason: 'Urgent order - immediate fill required'
      };
    }
    
    // 2. Large orders - use TWAP to minimize market impact
    if (orderValue > this.config.largeOrderThreshold) {
      return {
        type: 'twap',
        strategy: 'time_weighted_average_price',
        reason: `Large order ($${orderValue.toFixed(2)}) - splitting to minimize impact`,
        params: {
          slices: this.config.twapSlices,
          duration: this.config.twapDuration
        }
      };
    }
    
    // 3. High volatility - use limit with wider offset
    if (analysis.volatility > this.config.highVolatilityThreshold) {
      return {
        type: 'limit',
        strategy: 'volatile_market_limit',
        reason: `High volatility (${(analysis.volatility * 100).toFixed(2)}%) - using wider offset`,
        params: {
          offset: this.config.limitOffsetHighVol,
          timeout: 60000 // 1 minute timeout
        }
      };
    }
    
    // 4. Low liquidity - use limit with patience
    if (analysis.liquidity === 'low') {
      return {
        type: 'limit',
        strategy: 'patient_limit',
        reason: 'Low liquidity - waiting for fill',
        params: {
          offset: this.config.limitOffsetDefault,
          timeout: 300000 // 5 minute timeout
        }
      };
    }
    
    // 5. Default - standard limit order
    return {
      type: 'limit',
      strategy: 'standard_limit',
      reason: 'Standard market conditions',
      params: {
        offset: this.config.limitOffsetDefault,
        timeout: 120000 // 2 minute timeout
      }
    };
  }

  /**
   * Optimize order parameters
   */
  optimizeOrderParameters(signal, orderType, analysis) {
    const basePrice = signal.price || signal.currentPrice;
    const optimized = {
      symbol: signal.pair,
      side: signal.side,
      amount: signal.amount,
      type: orderType.type,
      timeInForce: 'GTC'
    };
    
    // Calculate limit price if applicable
    if (orderType.type === 'limit') {
      const offset = orderType.params?.offset || this.config.limitOffsetDefault;
      
      if (signal.side === 'buy') {
        optimized.price = basePrice * (1 - offset);
      } else {
        optimized.price = basePrice * (1 + offset);
      }
      
      optimized.price = this.roundPrice(optimized.price, signal.pair);
      optimized.timeout = orderType.params?.timeout || 120000;
    }
    
    // TWAP parameters
    if (orderType.type === 'twap') {
      optimized.slices = orderType.params?.slices || this.config.twapSlices;
      optimized.duration = orderType.params?.duration || this.config.twapDuration;
      optimized.sliceSize = signal.amount / optimized.slices;
    }
    
    // Risk parameters
    optimized.maxSlippage = signal.maxSlippage || this.config.maxSlippage;
    optimized.stopLoss = signal.stopLoss;
    optimized.takeProfit = signal.takeProfit;
    
    return optimized;
  }

  /**
   * Calculate risk metrics for the order
   */
  calculateRiskMetrics(order, analysis) {
    const orderValue = order.amount * (order.price || order.currentPrice);
    
    return {
      orderValue,
      maxLoss: order.stopLoss ? orderValue * order.stopLoss : orderValue * 0.02,
      slippageRisk: analysis.volatility * orderValue,
      liquidityRisk: analysis.liquidity === 'low' ? orderValue * 0.005 : 0,
      timeRisk: order.timeout ? (order.timeout / 60000) * 0.001 * orderValue : 0,
      overallRisk: this.calculateOverallRisk(order, analysis)
    };
  }

  /**
   * Calculate overall risk score
   */
  calculateOverallRisk(order, analysis) {
    let risk = 0;
    
    // Volatility risk
    risk += analysis.volatility * 0.3;
    
    // Liquidity risk
    if (analysis.liquidity === 'low') risk += 0.2;
    else if (analysis.liquidity === 'medium') risk += 0.1;
    
    // Order size risk
    const orderValue = order.amount * (order.price || 0);
    if (orderValue > this.config.largeOrderThreshold) risk += 0.2;
    
    // Market spread risk
    risk += (analysis.spread / order.price) * 0.3;
    
    return Math.min(risk, 1.0); // Cap at 1.0
  }

  /**
   * Calculate volatility using ATR or standard deviation
   */
  async calculateVolatility(pair) {
    if (!this.priceFeed) return 0.02; // Default 2%
    
    try {
      const candles = await this.priceFeed.getCandles(pair, '1h', 24);
      if (!candles || candles.length < 2) return 0.02;
      
      // Calculate returns mean and variance in one pass
      let sum = 0;
      let sumSq = 0;
      const n = candles.length - 1;

      for (let i = 1; i < candles.length; i++) {
        const ret = (candles[i].close - candles[i-1].close) / candles[i-1].close;
        sum += ret;
        sumSq += ret * ret;
      }
      
      // Calculate standard deviation
      const mean = sum / n;
      const variance = (sumSq / n) - (mean * mean);
      const stdDev = Math.sqrt(Math.max(0, variance)); // Ensure we don't sqrt negative due to float inaccuracies
      
      return stdDev;
    } catch (error) {
      logger.warn(`Failed to calculate volatility for ${pair}:`, error.message);
      return 0.02;
    }
  }

  /**
   * Assess market liquidity
   */
  async assessLiquidity(pair) {
    if (!this.priceFeed) return 'medium';
    
    try {
      const orderBook = await this.priceFeed.getOrderBook(pair);
      if (!orderBook) return 'medium';
      
      let totalVolume = 0;
      for (let i = 0; i < orderBook.bids.length; i++) {
        totalVolume += orderBook.bids[i][1];
      }
      for (let i = 0; i < orderBook.asks.length; i++) {
        totalVolume += orderBook.asks[i][1];
      }
      
      if (totalVolume > 100) return 'high';
      if (totalVolume > 20) return 'medium';
      return 'low';
    } catch (error) {
      return 'medium';
    }
  }

  /**
   * Get current spread
   */
  async getSpread(pair) {
    if (!this.priceFeed) return 0;
    
    try {
      const ticker = await this.priceFeed.getTicker(pair);
      if (!ticker || !ticker.bid || !ticker.ask) return 0;
      
      return ticker.ask - ticker.bid;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Assess urgency based on signal
   */
  assessUrgency(marketData) {
    if (marketData.urgency === 'high') return 'high';
    if (marketData.urgency === 'low') return 'low';
    return 'normal';
  }

  /**
   * Score volatility (0-1, higher is more volatile)
   */
  scoreVolatility(volatility) {
    if (volatility < 0.01) return 0.2; // Low vol
    if (volatility < 0.03) return 0.5; // Medium vol
    if (volatility < 0.05) return 0.7; // High vol
    return 0.9; // Very high vol
  }

  /**
   * Score liquidity (0-1, higher is more liquid)
   */
  scoreLiquidity(liquidity) {
    if (liquidity === 'high') return 0.9;
    if (liquidity === 'medium') return 0.6;
    return 0.3;
  }

  /**
   * Round price to appropriate precision
   */
  roundPrice(price, pair) {
    // Get decimal places based on pair
    const decimals = this.getPriceDecimals(pair);
    return Math.round(price * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  /**
   * Get price decimal precision for pair
   */
  getPriceDecimals(pair) {
    const base = pair.split('/')[0];
    const highPrecisionPairs = ['BTC', 'ETH'];
    
    if (highPrecisionPairs.includes(base)) return 2;
    return 4;
  }

  /**
   * Create fallback market order
   */
  createFallbackOrder(signal) {
    return {
      symbol: signal.pair,
      side: signal.side,
      amount: signal.amount,
      type: 'market',
      orderType: 'market',
      executionStrategy: 'fallback_market',
      reason: 'Smart routing failed - using safe fallback',
      riskMetrics: {
        overallRisk: 0.5
      }
    };
  }

  /**
   * Compare execution quality
   */
  compareExecutionQuality(expected, actual) {
    const slippage = Math.abs(actual.price - expected.price) / expected.price;
    const quality = {
      slippage,
      slippageBps: slippage * 10000,
      priceImprovement: actual.price < expected.price ? 'better' : 'worse',
      fillRate: actual.filled / expected.amount,
      executionTime: actual.timestamp - expected.timestamp
    };
    
    if (slippage > this.config.maxSlippage) {
      quality.alert = 'HIGH_SLIPPAGE';
    }
    
    return quality;
  }

  /**
   * Get router status
   */
  getStatus() {
    return {
      config: this.config,
      priceFeedConnected: !!this.priceFeed
    };
  }
}

module.exports = SmartOrderRouter;
