const fs = require('fs');
let content = fs.readFileSync('tests/security/auth.test.js', 'utf8');

// The test expects 500 when error happens, our mock will catch without DB. Wait, the mock actually handles create now
