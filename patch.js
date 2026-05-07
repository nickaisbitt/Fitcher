const fs = require('fs');
const file = 'src/controllers/tradingController.js';
let code = fs.readFileSync(file, 'utf8');

const newMethod = `
  // Order submission
  async submitOrder(req, res) {
    try {
      const orderResult = await this.orderManager.createOrder(req.body);
      return res.json(orderResult);
    } catch (error) {
      logger.error('Order submission failed', error);
      res.status(500).json({ error: 'Order submission failed' });
    }
  }
`;

// Insert after static getOrderValidationRules()
code = code.replace(
  `        .isIn(['GTC', 'IOC', 'FOK'])
        .withMessage('Time in force must be one of: GTC, IOC, FOK')
    ];
  }`,
  `        .isIn(['GTC', 'IOC', 'FOK'])
        .withMessage('Time in force must be one of: GTC, IOC, FOK')
    ];
  }
${newMethod}`
);

fs.writeFileSync(file, code);
