const EventEmitter = require('events');
const WebSocket = require('ws');
const logger = require('../utils/logger');

class MarketDataWebSocket extends EventEmitter {
  constructor(exchangeName, config = {}) {
    super();
    this.exchangeName = exchangeName;
    this.config = config;
    this.ws = null;
    this.isConnected = false;
    this.subscriptions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.reconnectDelay = config.reconnectDelay || 1000;
    this.heartbeatInterval = config.heartbeatInterval || 30000;
    this.heartbeatTimer = null;
    this.lastMessageTime = null;
  }

  async connect() {
    try {
      logger.info(`[${this.exchangeName}] Connecting to WebSocket...`);
      
      const wsUrl = this.getWebSocketUrl();
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('close', (code, reason) => this.handleClose(code, reason));
      this.ws.on('error', (error) => this.handleError(error));
      
      return new Promise((resolve, reject) => {
        this.ws.once('open', resolve);
        this.ws.once('error', reject);
      });
    } catch (error) {
      logger.error(`[${this.exchangeName}] WebSocket connection error:`, error);
      throw error;
    }
  }

  getWebSocketUrl() {
    // Exchange-specific WebSocket URLs
    const urls = {
      kraken: 'wss://ws.kraken.com/',
      binance: 'wss://stream.binance.com:9443/ws',
      coinbase: 'wss://ws-feed.exchange.coinbase.com'
    };
    
    return urls[this.exchangeName.toLowerCase()] || urls.kraken;
  }

  handleOpen() {
    logger.info(`[${this.exchangeName}] WebSocket connected`);
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.lastMessageTime = Date.now();
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Resubscribe to previous subscriptions
    this.resubscribeAll();
    
    this.emit('connected');
  }

  handleMessage(data) {
    try {
      this.lastMessageTime = Date.now();
      const message = JSON.parse(data);
      
      logger.debug(`[${this.exchangeName}] Received message:`, message);
      
      // Process message based on exchange-specific format
      const processedData = this.processMessage(message);
      
      if (processedData) {
        this.emit('data', processedData);
      }
    } catch (error) {
      logger.error(`[${this.exchangeName}] Message processing error:`, error);
    }
  }

  processMessage(message) {
    // Exchange-specific message processing
    switch (this.exchangeName.toLowerCase()) {
      case 'kraken':
        return this.processKrakenMessage(message);
      case 'binance':
        return this.processBinanceMessage(message);
      case 'coinbase':
        return this.processCoinbaseMessage(message);
      default:
        return message;
    }
  }

  processKrakenMessage(message) {
    // Kraken message format processing
    if (message.event === 'heartbeat') {
      return null; // Ignore heartbeats
    }
    
    if (Array.isArray(message) && message.length >= 4) {
      const [channelId, data, channelName, pair] = message;
      
      if (channelName === 'ticker') {
        return {
          type: 'ticker',
          exchange: 'kraken',
          pair: pair,
          data: {
            price: data.c[0],
            volume: data.v[1],
            high: data.h[1],
            low: data.l[1],
            open: data.o[1],
            bid: data.b[0],
            ask: data.a[0]
          },
          timestamp: Date.now()
        };
      }
      
      if (channelName === 'book') {
        return {
          type: 'orderbook',
          exchange: 'kraken',
          pair: pair,
          data: {
            bids: data.bs || [],
            asks: data.as || []
          },
          timestamp: Date.now()
        };
      }
      
      if (channelName === 'trade') {
        return {
          type: 'trade',
          exchange: 'kraken',
          pair: pair,
          data: data.map(trade => ({
            price: trade[0],
            volume: trade[1],
            time: trade[2],
            side: trade[3],
            orderType: trade[4]
          })),
          timestamp: Date.now()
        };
      }
    }
    
    return null;
  }

  processBinanceMessage(message) {
    // Binance message format processing
    if (message.e === 'trade') {
      return {
        type: 'trade',
        exchange: 'binance',
        pair: message.s,
        data: {
          price: message.p,
          volume: message.q,
          time: message.T,
          buyerOrderId: message.b,
          sellerOrderId: message.a,
          tradeId: message.t,
          isBuyerMaker: message.m
        },
        timestamp: Date.now()
      };
    }
    
    if (message.e === 'aggTrade') {
      return {
        type: 'aggregated_trade',
        exchange: 'binance',
        pair: message.s,
        data: {
          price: message.p,
          volume: message.q,
          firstTradeId: message.f,
          lastTradeId: message.l,
          time: message.T,
          isBuyerMaker: message.m
        },
        timestamp: Date.now()
      };
    }
    
    if (message.e === 'depthUpdate') {
      return {
        type: 'orderbook',
        exchange: 'binance',
        pair: message.s,
        data: {
          bids: message.b,
          asks: message.a,
          lastUpdateId: message.u,
          firstUpdateId: message.U
        },
        timestamp: Date.now()
      };
    }
    
    if (message.e === '24hrTicker') {
      return {
        type: 'ticker',
        exchange: 'binance',
        pair: message.s,
        data: {
          price: message.c,
          open: message.o,
          high: message.h,
          low: message.l,
          volume: message.v,
          quoteVolume: message.q,
          priceChange: message.p,
          priceChangePercent: message.P,
          weightedAvgPrice: message.w,
          lastQty: message.Q,
          bid: message.b,
          bidQty: message.B,
          ask: message.a,
          askQty: message.A
        },
        timestamp: Date.now()
      };
    }
    
    return null;
  }

  processCoinbaseMessage(message) {
    // Coinbase message format processing
    if (message.type === 'ticker') {
      return {
        type: 'ticker',
        exchange: 'coinbase',
        pair: message.product_id,
        data: {
          price: message.price,
          volume: message.volume_24h,
          high: message.high_24h,
          low: message.low_24h,
          open: message.open_24h,
          best_bid: message.best_bid,
          best_ask: message.best_ask,
          side: message.side,
          time: message.time
        },
        timestamp: Date.now()
      };
    }
    
    if (message.type === 'match') {
      return {
        type: 'trade',
        exchange: 'coinbase',
        pair: message.product_id,
        data: {
          price: message.price,
          volume: message.size,
          time: message.time,
          side: message.side,
          tradeId: message.trade_id,
          makerOrderId: message.maker_order_id,
          takerOrderId: message.taker_order_id
        },
        timestamp: Date.now()
      };
    }
    
    if (message.type === 'snapshot') {
      return {
        type: 'orderbook',
        exchange: 'coinbase',
        pair: message.product_id,
        data: {
          bids: message.bids,
          asks: message.asks
        },
        timestamp: Date.now()
      };
    }
    
    if (message.type === 'l2update') {
      return {
        type: 'orderbook_update',
        exchange: 'coinbase',
        pair: message.product_id,
        data: {
          changes: message.changes
        },
        timestamp: Date.now()
      };
    }
    
    return null;
  }

  handleClose(code, reason) {
    logger.warn(`[${this.exchangeName}] WebSocket closed: ${code} - ${reason}`);
    this.isConnected = false;
    this.stopHeartbeat();
    
    this.emit('disconnected', { code, reason });
    
    // Attempt reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnect();
    } else {
      logger.error(`[${this.exchangeName}] Max reconnection attempts reached`);
      this.emit('maxReconnectReached');
    }
  }

  handleError(error) {
    logger.error(`[${this.exchangeName}] WebSocket error:`, error);
    this.emit('error', error);
  }

  async reconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    logger.info(`[${this.exchangeName}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await this.connect();
    } catch (error) {
      logger.error(`[${this.exchangeName}] Reconnection failed:`, error);
    }
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        const timeSinceLastMessage = Date.now() - this.lastMessageTime;
        
        if (timeSinceLastMessage > this.heartbeatInterval * 2) {
          logger.warn(`[${this.exchangeName}] No message received for ${timeSinceLastMessage}ms, reconnecting...`);
          this.ws.terminate();
          this.reconnect();
        }
      }
    }, this.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Subscribe to market data
  subscribe(channel, pair) {
    const subscriptionKey = `${channel}:${pair}`;
    
    if (this.subscriptions.has(subscriptionKey)) {
      logger.warn(`[${this.exchangeName}] Already subscribed to ${subscriptionKey}`);
      return;
    }
    
    const subscription = this.createSubscriptionMessage(channel, pair);
    
    if (this.isConnected) {
      this.ws.send(JSON.stringify(subscription));
    }
    
    this.subscriptions.set(subscriptionKey, { channel, pair, subscription });
    logger.info(`[${this.exchangeName}] Subscribed to ${subscriptionKey}`);
  }

  // Unsubscribe from market data
  unsubscribe(channel, pair) {
    const subscriptionKey = `${channel}:${pair}`;
    
    if (!this.subscriptions.has(subscriptionKey)) {
      logger.warn(`[${this.exchangeName}] Not subscribed to ${subscriptionKey}`);
      return;
    }
    
    const unsubscription = this.createUnsubscriptionMessage(channel, pair);
    
    if (this.isConnected) {
      this.ws.send(JSON.stringify(unsubscription));
    }
    
    this.subscriptions.delete(subscriptionKey);
    logger.info(`[${this.exchangeName}] Unsubscribed from ${subscriptionKey}`);
  }

  createSubscriptionMessage(channel, pair) {
    // Exchange-specific subscription messages
    switch (this.exchangeName.toLowerCase()) {
      case 'kraken':
        return {
          event: 'subscribe',
          pair: [pair],
          subscription: { name: channel }
        };
      case 'binance':
        const streamMap = {
          ticker: `${pair.toLowerCase()}@ticker`,
          trade: `${pair.toLowerCase()}@trade`,
          orderbook: `${pair.toLowerCase()}@depth`
        };
        return {
          method: 'SUBSCRIBE',
          params: [streamMap[channel] || `${pair.toLowerCase()}@${channel}`],
          id: Date.now()
        };
      case 'coinbase':
        return {
          type: 'subscribe',
          product_ids: [pair],
          channels: [channel]
        };
      default:
        return { channel, pair };
    }
  }

  createUnsubscriptionMessage(channel, pair) {
    // Exchange-specific unsubscription messages
    switch (this.exchangeName.toLowerCase()) {
      case 'kraken':
        return {
          event: 'unsubscribe',
          pair: [pair],
          subscription: { name: channel }
        };
      case 'binance':
        const streamMap = {
          ticker: `${pair.toLowerCase()}@ticker`,
          trade: `${pair.toLowerCase()}@trade`,
          orderbook: `${pair.toLowerCase()}@depth`
        };
        return {
          method: 'UNSUBSCRIBE',
          params: [streamMap[channel] || `${pair.toLowerCase()}@${channel}`],
          id: Date.now()
        };
      case 'coinbase':
        return {
          type: 'unsubscribe',
          product_ids: [pair],
          channels: [channel]
        };
      default:
        return { channel, pair };
    }
  }

  resubscribeAll() {
    logger.info(`[${this.exchangeName}] Resubscribing to ${this.subscriptions.size} channels`);
    
    for (const [key, { channel, pair }] of this.subscriptions) {
      this.subscribe(channel, pair);
    }
  }

  disconnect() {
    logger.info(`[${this.exchangeName}] Disconnecting WebSocket...`);
    
    this.stopHeartbeat();
    
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.subscriptions.clear();
    
    logger.info(`[${this.exchangeName}] WebSocket disconnected`);
  }

  getStatus() {
    return {
      exchange: this.exchangeName,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      subscriptionsCount: this.subscriptions.size,
      lastMessageTime: this.lastMessageTime,
      subscriptions: Array.from(this.subscriptions.keys())
    };
  }
}

module.exports = MarketDataWebSocket;