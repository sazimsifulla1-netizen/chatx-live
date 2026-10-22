const test=require('node:test'),assert=require('node:assert/strict');
// Set fake env for import; no database connection attempted during module import.
process.env.DATABASE_URL='postgres://user:pass@localhost:5432/chatx';process.env.JWT_SECRET='a'.repeat(48);
const {validPhone,validName}=require('../server');
test('BD phone validation',()=>{assert.equal(validPhone('01712345678'),true);assert.equal(validPhone('01212345678'),false);assert.equal(validPhone('0171234'),false)});
test('username validation',()=>{assert.equal(validName('user_123'),true);assert.equal(validName('ab'),false);assert.equal(validName('bad space'),false)});
