const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class TradingRule {
  constructor(config) {
    this.id = config.id || uuidv4();
    this.userId = config.userId;
    this.name = config.name;
    this.description = config.description || '';
    this.status = config.status || 'active'; // active, paused, triggered, expired
    
    // Rule conditions
    this.conditions = config.conditions || []; // Array of condition objects
    this.operator = config.operator || 'AND'; // AND, OR
    
    // Rule actions
    this.actions = config.actions || []; // Array of action objects
    
    // Rule settings
    this.exchange = config.exchange;
    this.pair = config.pair;
    this.maxExecutions = config.maxExecutions || 1; // How many times rule can trigger
    this.executionCount = 0;
    
    // Cooldown
    this.cooldownPeriod = config.cooldownPeriod || 0; // Milliseconds between executions
    this.lastTriggeredAt = null;
    
    // Expiration
    this.expiresAt = config.expiresAt || null;
    
    // Metadata
    this.triggerHistory = [];
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  // Evaluate rule conditions
  evaluate(marketData, portfolio, positions) {
    if (this.status !== 'active') {
      return { triggered: false, reason: `Rule status: ${this.status}` };
    }

    // Check expiration
    if (this.expiresAt && new Date() > new Date(this.expiresAt)) {
      this.status = 'expired';
      return { triggered: false, reason: 'Rule expired' };
    }

    // Check max executions
    if (this.executionCount >= this.maxExecutions) {
      this.status = 'triggered';
      return { triggered: false, reason: 'Max executions reached' };
    }

    // Check cooldown
    if (this.cooldownPeriod > 0 && this.lastTriggeredAt) {
      const elapsed = Date.now() - this.lastTriggeredAt;
      if (elapsed < this.cooldownPeriod) {
        return { 
          triggered: false, 
          reason: `Cooldown active. ${Math.ceil((this.cooldownPeriod - elapsed) / 1000)}s remaining` 
        };
      }
    }

    // Evaluate conditions
    let conditionsMet = this.operator === 'AND';
    const conditionResults = [];

    for (const condition of this.conditions) {
      const result = this.evaluateCondition(condition, marketData, portfolio, positions);
      conditionResults.push({ condition, result });

      if (this.operator === 'AND') {
        conditionsMet = conditionsMet && result.met;
        if (!conditionsMet) break; // Short-circuit
      } else {
        conditionsMet = conditionsMet || result.met;
        if (conditionsMet) break; // Short-circuit
      }
    }

    return {
      triggered: conditionsMet,
      conditionResults,
      operator: this.operator
    };
  }

  // Evaluate single condition
  evaluateCondition(condition, marketData, portfolio, positions) {
    const { type, params } = condition;

    switch (type) {
      case 'price_above':
        return this.checkPriceAbove(params, marketData);
      case 'price_below':
        return this.checkPriceBelow(params, marketData);
      case 'price_change':
        return this.checkPriceChange(params, marketData);
      case 'volume_spike':
        return this.checkVolumeSpike(params, marketData);
      case 'portfolio_value':
        return this.checkPortfolioValue(params, portfolio);
      case 'position_size':
        return this.checkPositionSize(params, positions);
      case 'time_of_day':
        return this.checkTimeOfDay(params);
      case 'day_of_week':
        return this.checkDayOfWeek(params);
      case 'custom':
        return this.evaluateCustomCondition(params, marketData, portfolio, positions);
      default:
        return { met: false, error: `Unknown condition type: ${type}` };
    }
  }

  // Check if price is above threshold
  checkPriceAbove(params, marketData) {
    const { pair, threshold } = params;
    const price = marketData.pairs?.[pair]?.price;

    if (!price) {
      return { met: false, error: `No price data for ${pair}` };
    }

    return {
      met: price > threshold,
      price,
      threshold,
      pair
    };
  }

  // Check if price is below threshold
  checkPriceBelow(params, marketData) {
    const { pair, threshold } = params;
    const price = marketData.pairs?.[pair]?.price;

    if (!price) {
      return { met: false, error: `No price data for ${pair}` };
    }

    return {
      met: price < threshold,
      price,
      threshold,
      pair
    };
  }

  // Check price change percentage
  checkPriceChange(params, marketData) {
    const { pair, period, changePercent, direction } = params;
    const pairData = marketData.pairs?.[pair];

    if (!pairData) {
      return { met: false, error: `No data for ${pair}` };
    }

    const currentPrice = pairData.price;
    const referencePrice = pairData[`price${period}Ago`] || pairData.price * (1 - changePercent / 100);
    const actualChange = ((currentPrice - referencePrice) / referencePrice) * 100;

    let met = false;
    if (direction === 'up') {
      met = actualChange >= changePercent;
    } else if (direction === 'down') {
      met = actualChange <= -changePercent;
    } else {
      met = Math.abs(actualChange) >= changePercent;
    }

    return {
      met,
      currentPrice,
      referencePrice,
      actualChange,
      targetChange: changePercent,
      direction
    };
  }

  // Check for volume spike
  checkVolumeSpike(params, marketData) {
    const { pair, multiplier } = params;
    const pairData = marketData.pairs?.[pair];

    if (!pairData) {
      return { met: false, error: `No data for ${pair}` };
    }

    const currentVolume = pairData.volume;
    const avgVolume = pairData.avgVolume || currentVolume;
    const volumeRatio = currentVolume / avgVolume;

    return {
      met: volumeRatio >= multiplier,
      currentVolume,
      avgVolume,
      volumeRatio,
      targetMultiplier: multiplier
    };
  }

  // Check portfolio value condition
  checkPortfolioValue(params, portfolio) {
    const { operator, value } = params;
    const portfolioValue = portfolio?.totalValue || 0;

    let met = false;
    switch (operator) {
      case 'gt':
        met = portfolioValue > value;
        break;
      case 'lt':
        met = portfolioValue < value;
        break;
      case 'gte':
        met = portfolioValue >= value;
        break;
      case 'lte':
        met = portfolioValue <= value;
        break;
      case 'eq':
        met = portfolioValue === value;
        break;
    }

    return {
      met,
      portfolioValue,
      operator,
      targetValue: value
    };
  }

  // Check position size condition
  checkPositionSize(params, positions) {
    const { asset, operator, value, unit = 'amount' } = params;
    const position = positions?.find(p => p.asset === asset);
    const positionValue = unit === 'amount' 
      ? (position?.totalAmount || 0)
      : (position?.totalValue || 0);

    let met = false;
    switch (operator) {
      case 'gt':
        met = positionValue > value;
        break;
      case 'lt':
        met = positionValue < value;
        break;
      case 'gte':
        met = positionValue >= value;
        break;
      case 'lte':
        met = positionValue <= value;
        break;
      case 'eq':
        met = positionValue === value;
        break;
    }

    return {
      met,
      asset,
      positionValue,
      operator,
      targetValue: value,
      unit
    };
  }

  // Check time of day
  checkTimeOfDay(params) {
    const { startTime, endTime, timezone = 'UTC' } = params;
    const now = new Date();
    
    // Convert to target timezone (simplified)
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    const met = currentTime >= startMinutes && currentTime <= endMinutes;

    return {
      met,
      currentTime: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
      startTime,
      endTime,
      timezone
    };
  }

  // Check day of week
  checkDayOfWeek(params) {
    const { days } = params; // Array of day names or numbers
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const met = days.some(day => {
      if (typeof day === 'number') return day === currentDay;
      return day.toLowerCase() === dayNames[currentDay].toLowerCase();
    });

    return {
      met,
      currentDay: dayNames[currentDay],
      allowedDays: days
    };
  }

  // Evaluate custom condition (placeholder for user-defined logic)
  evaluateCustomCondition(params, marketData, portfolio, positions) {
    // In production, this could execute user-defined JavaScript
    // For now, return false for safety
    return {
      met: false,
      reason: 'Custom conditions not implemented'
    };
  }

  // Execute rule actions
  executeActions(triggerData) {
    const results = [];

    for (const action of this.actions) {
      try {
        const result = this.executeAction(action, triggerData);
        results.push(result);
      } catch (error) {
        logger.error(`Error executing action ${action.type}:`, error);
        results.push({ success: false, error: error.message });
      }
    }

    return results;
  }

  // Execute single action
  executeAction(action, triggerData) {
    const { type, params } = action;

    switch (type) {
      case 'place_order':
        return this.actionPlaceOrder(params, triggerData);
      case 'send_notification':
        return this.actionSendNotification(params, triggerData);
      case 'update_strategy':
        return this.actionUpdateStrategy(params, triggerData);
      case 'webhook':
        return this.actionWebhook(params, triggerData);
      default:
        return { success: false, error: `Unknown action type: ${type}` };
    }
  }

  // Place order action
  actionPlaceOrder(params, triggerData) {
    const orderParams = {
      userId: this.userId,
      exchange: params.exchange || this.exchange,
      pair: params.pair || this.pair,
      type: params.orderType || 'market',
      side: params.side,
      amount: params.amount,
      price: params.price,
      ...params
    };

    return {
      success: true,
      type: 'place_order',
      params: orderParams,
      triggeredBy: triggerData
    };
  }

  // Send notification action
  actionSendNotification(params, triggerData) {
    const notification = {
      userId: this.userId,
      title: params.title || `Trading Rule Triggered: ${this.name}`,
      message: params.message || `Rule "${this.name}" has been triggered`,
      data: {
        ruleId: this.id,
        ruleName: this.name,
        triggerData
      },
      channels: params.channels || ['in_app']
    };

    return {
      success: true,
      type: 'send_notification',
      notification
    };
  }

  // Update strategy action
  actionUpdateStrategy(params, triggerData) {
    return {
      success: true,
      type: 'update_strategy',
      strategyId: params.strategyId,
      updates: params.updates
    };
  }

  // Webhook action
  actionWebhook(params, triggerData) {
    return {
      success: true,
      type: 'webhook',
      url: params.url,
      method: params.method || 'POST',
      headers: params.headers || {},
      payload: {
        ruleId: this.id,
        ruleName: this.name,
        timestamp: new Date(),
        triggerData,
        ...params.payload
      }
    };
  }

  // Trigger the rule
  trigger(marketData, portfolio, positions) {
    const evaluation = this.evaluate(marketData, portfolio, positions);

    if (!evaluation.triggered) {
      return { triggered: false, reason: evaluation.reason };
    }

    // Execute actions
    const actionResults = this.executeActions(evaluation);

    // Update rule state
    this.executionCount++;
    this.lastTriggeredAt = Date.now();
    this.updatedAt = new Date();

    // Record trigger
    this.triggerHistory.push({
      timestamp: new Date(),
      marketData,
      portfolio,
      evaluation,
      actionResults
    });

    // Check if max executions reached
    if (this.executionCount >= this.maxExecutions) {
      this.status = 'triggered';
    }

    logger.info(`Trading rule ${this.id} triggered`, {
      ruleName: this.name,
      executionCount: this.executionCount,
      actions: actionResults.length
    });

    return {
      triggered: true,
      ruleId: this.id,
      ruleName: this.name,
      evaluation,
      actionResults
    };
  }

  // Get rule summary
  getSummary() {
    return {
      id: this.id,
      userId: this.userId,
      name: this.name,
      description: this.description,
      status: this.status,
      exchange: this.exchange,
      pair: this.pair,
      conditions: this.conditions,
      operator: this.operator,
      actions: this.actions,
      maxExecutions: this.maxExecutions,
      executionCount: this.executionCount,
      cooldownPeriod: this.cooldownPeriod,
      expiresAt: this.expiresAt,
      triggerCount: this.triggerHistory.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastTriggeredAt: this.lastTriggeredAt
    };
  }

  // Pause rule
  pause() {
    this.status = 'paused';
    this.updatedAt = new Date();
    return { success: true, message: 'Rule paused' };
  }

  // Resume rule
  resume() {
    this.status = 'active';
    this.updatedAt = new Date();
    return { success: true, message: 'Rule resumed' };
  }

  // Reset rule
  reset() {
    this.executionCount = 0;
    this.lastTriggeredAt = null;
    this.status = 'active';
    this.triggerHistory = [];
    this.updatedAt = new Date();
    return { success: true, message: 'Rule reset' };
  }
}

module.exports = TradingRule;