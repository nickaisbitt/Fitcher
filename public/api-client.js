// Fitcher API Client - Connects frontend to backend API
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api' 
  : '/api';

class FitcherAPI {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.token = null;
  }

  // Set authentication token
  setToken(token) {
    this.token = token;
    localStorage.setItem('fitcher_token', token);
  }

  // Get stored token
  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem('fitcher_token');
    }
    return this.token;
  }

  // Clear token (logout)
  clearToken() {
    this.token = null;
    localStorage.removeItem('fitcher_token');
  }

  // Make authenticated request
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // ==================== AUTHENTICATION ====================
  
  async signup(email, password, name) {
    const data = await this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    
    if (data.success && data.data.accessToken) {
      this.setToken(data.data.accessToken);
    }
    
    return data;
  }

  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    if (data.success && data.data.accessToken) {
      this.setToken(data.data.accessToken);
    }
    
    return data;
  }

  async refreshToken(refreshToken) {
    return this.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    });
  }

  logout() {
    this.clearToken();
  }

  isAuthenticated() {
    return !!this.getToken();
  }

  // ==================== USER PROFILE ====================
  
  async getProfile() {
    return this.request('/profile');
  }

  async getApiKeys() {
    return this.request('/keys');
  }

  // ==================== MARKET DATA ====================
  
  async getPrice(pair, exchange = null) {
    const query = exchange ? `?exchange=${exchange}` : '';
    return this.request(`/market/price/${pair}${query}`);
  }

  async getAllPrices() {
    return this.request('/market/prices');
  }

  async getOrderBook(pair, exchange = null, depth = 10) {
    const query = exchange ? `?exchange=${exchange}&depth=${depth}` : `?depth=${depth}`;
    return this.request(`/market/orderbook/${pair}${query}`);
  }

  async getTrades(pair, exchange = null, limit = 50) {
    const query = exchange ? `?exchange=${exchange}&limit=${limit}` : `?limit=${limit}`;
    return this.request(`/market/trades/${pair}${query}`);
  }

  async getCandles(pair, timeframe = '1h', limit = 100) {
    return this.request(`/market/candles/${pair}?timeframe=${timeframe}&limit=${limit}`);
  }

  // ==================== TRADING ====================
  
  async createOrder(orderData) {
    return this.request('/trading/orders', {
      method: 'POST',
      body: JSON.stringify(orderData)
    });
  }

  async getOrders(status = null) {
    const query = status ? `?status=${status}` : '';
    return this.request(`/trading/orders${query}`);
  }

  async getOrder(orderId) {
    return this.request(`/trading/orders/${orderId}`);
  }

  async cancelOrder(orderId) {
    return this.request(`/trading/orders/${orderId}/cancel`, {
      method: 'POST'
    });
  }

  async getPositions() {
    return this.request('/trading/positions');
  }

  async getPortfolio() {
    return this.request('/trading/portfolio');
  }

  // ==================== STRATEGIES ====================
  
  async getStrategies() {
    return this.request('/trading/strategies');
  }

  async createStrategy(strategyData) {
    return this.request('/trading/strategies', {
      method: 'POST',
      body: JSON.stringify(strategyData)
    });
  }

  async updateStrategy(strategyId, strategyData) {
    return this.request(`/trading/strategies/${strategyId}`, {
      method: 'PUT',
      body: JSON.stringify(strategyData)
    });
  }

  async deleteStrategy(strategyId) {
    return this.request(`/trading/strategies/${strategyId}`, {
      method: 'DELETE'
    });
  }

  async activateStrategy(strategyId) {
    return this.request(`/trading/strategies/${strategyId}/activate`, {
      method: 'POST'
    });
  }

  async deactivateStrategy(strategyId) {
    return this.request(`/trading/strategies/${strategyId}/deactivate`, {
      method: 'POST'
    });
  }

  // ==================== TRADING RULES ====================
  
  async getTradingRules() {
    return this.request('/trading/rules');
  }

  async createTradingRule(ruleData) {
    return this.request('/trading/rules', {
      method: 'POST',
      body: JSON.stringify(ruleData)
    });
  }

  async updateTradingRule(ruleId, ruleData) {
    return this.request(`/trading/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(ruleData)
    });
  }

  async deleteTradingRule(ruleId) {
    return this.request(`/trading/rules/${ruleId}`, {
      method: 'DELETE'
    });
  }

  // ==================== EXCHANGES ====================
  
  async getExchanges() {
    return this.request('/exchanges');
  }

  async connectExchange(exchange, apiKey, apiSecret) {
    return this.request('/exchanges/connect', {
      method: 'POST',
      body: JSON.stringify({ exchange, apiKey, apiSecret })
    });
  }

  async disconnectExchange(exchange) {
    return this.request(`/exchanges/${exchange}/disconnect`, {
      method: 'POST'
    });
  }

  async getExchangeBalance(exchange) {
    return this.request(`/exchanges/${exchange}/balance`);
  }
}

// Create singleton instance
const fitcherAPI = new FitcherAPI();

// Export for use in React components
if (typeof window !== 'undefined') {
  window.fitcherAPI = fitcherAPI;
}

// Also export as ES module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = fitcherAPI;
}
