import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,STALE_MS} from '../src/health.js';
test('heartbeat rejects stale, missing and wrong-deployment records',()=>{
 const now=Date.now(), beat={at:now,state:'online' as const,chainId:process.env.CHAIN_ID||'133',escrow:(process.env.ESCROW_ADDRESS||'').toLowerCase()};
 assert.equal(classify(beat,now).status,'online');
 assert.equal(classify({...beat,state:'degraded'},now).status,'degraded');
 assert.equal(classify(null,now).status,'offline');
 assert.equal(classify(beat,now+STALE_MS+1).status,'offline');
 assert.equal(classify({...beat,at:now+60000},now).status,'offline');
 assert.equal(classify({...beat,escrow:'wrong deployment'},now).status,'unknown');
});
