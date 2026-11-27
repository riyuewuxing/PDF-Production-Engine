const fs=require('node:fs');
const target=process.env.T47_NETWORK_SENTINEL;
if(!target)throw Error('missing network sentinel');
function refuse(){fs.appendFileSync(target,'blocked\n');throw Error('network disabled for stdio validation')}
global.fetch=refuse;
require('node:net').Socket.prototype.connect=refuse;
require('node:http').request=refuse;
require('node:http').get=refuse;
require('node:https').request=refuse;
require('node:https').get=refuse;
require('node:dgram').createSocket=refuse;
