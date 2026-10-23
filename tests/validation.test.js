const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgres://example:pass@localhost:5432/chatx';process.env.JWT_SECRET='a'.repeat(48);
const {validPhone,validName,validPassword,validPoint,editablePath,constantEqual}=require('../server');
test('phone rules',()=>{assert.equal(validPhone('01712345678'),true);assert.equal(validPhone('01212345678'),false);assert.equal(validPhone('01712345'),false)});
test('username rules',()=>{assert.equal(validName('chatx_user'),true);assert.equal(validName('a2'),false);assert.equal(validName('bad space'),false)});
test('password six characters minimum',()=>{assert.equal(validPassword('abc123'),true);assert.equal(validPassword('abc12'),false);assert.equal(validPassword('a'.repeat(129)),false)});
test('location points cannot be nonsensical',()=>{assert.equal(validPoint({lat:23.7,lng:90.4,accuracy:25}),true);assert.equal(validPoint({lat:100,lng:90,accuracy:30}),false);assert.equal(validPoint({lat:23,lng:200,accuracy:10}),false)});
test('admin source paths allow code but no secrets',()=>{assert.equal(editablePath('public/admin.js'),true);assert.equal(editablePath('server.js'),true);assert.equal(editablePath('.env'),false);assert.equal(editablePath('../secret'),false)});
test('constant equality function',()=>{assert.equal(constantEqual('ABC','ABC'),true);assert.equal(constantEqual('ABC','abc'),false)});

// Admin credentials must come from Render environment, never client code.
test('admin is enabled with username plus 6+ character password (second key optional)',()=>{
 const {adminEnabled}=require('../server');
 const oldU=process.env.ADMIN_USERNAME, oldP=process.env.ADMIN_PASSWORD, oldS=process.env.ADMIN_SECOND_KEY;
 try {
  process.env.ADMIN_USERNAME='@DemoAdmin';process.env.ADMIN_PASSWORD='testpass';delete process.env.ADMIN_SECOND_KEY;
  assert.equal(adminEnabled(),true);
  process.env.ADMIN_PASSWORD='short';assert.equal(adminEnabled(),false);
 }finally{
  for(const [k,v] of [['ADMIN_USERNAME',oldU],['ADMIN_PASSWORD',oldP],['ADMIN_SECOND_KEY',oldS]]){if(v===undefined)delete process.env[k];else process.env[k]=v}
 }
});

// Location consent and a valid point are both required by registration, including direct API requests.
test('registration location consent is mandatory',()=>{
 const {validRegistrationLocation}=require('../server');
 const good={lat:23.77,lng:90.41,accuracy:18};
 assert.equal(validRegistrationLocation({locationConsent:true,registrationLocation:good}),true);
 assert.equal(validRegistrationLocation({locationConsent:false,registrationLocation:good}),false);
 assert.equal(validRegistrationLocation({locationConsent:true}),false);
 assert.equal(validRegistrationLocation({registrationLocation:good}),false);
 assert.equal(validRegistrationLocation({locationConsent:true,registrationLocation:{lat:999,lng:90,accuracy:10}}),false);
});
