const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgres://example:pass@localhost:5432/chatx';process.env.JWT_SECRET='a'.repeat(48);
const {validPhone,validName,validPassword,validPoint,editablePath,constantEqual}=require('../server');
test('phone rules',()=>{assert.equal(validPhone('01712345678'),true);assert.equal(validPhone('01212345678'),false);assert.equal(validPhone('01712345'),false)});
test('username rules',()=>{assert.equal(validName('chatx_user'),true);assert.equal(validName('a2'),false);assert.equal(validName('bad space'),false)});
test('password six characters minimum',()=>{assert.equal(validPassword('abc123'),true);assert.equal(validPassword('abc12'),false);assert.equal(validPassword('a'.repeat(129)),false)});
test('location points cannot be nonsensical',()=>{assert.equal(validPoint({lat:23.7,lng:90.4,accuracy:25}),true);assert.equal(validPoint({lat:100,lng:90,accuracy:30}),false);assert.equal(validPoint({lat:23,lng:200,accuracy:10}),false)});
test('admin source paths allow code but no secrets',()=>{assert.equal(editablePath('public/admin.js'),true);assert.equal(editablePath('server.js'),true);assert.equal(editablePath('.env'),false);assert.equal(editablePath('../secret'),false)});
test('constant equality function',()=>{assert.equal(constantEqual('ABC','ABC'),true);assert.equal(constantEqual('ABC','abc'),false)});
