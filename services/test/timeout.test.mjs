import {test} from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {createPublicClient,createWalletClient,custom,keccak256,stringToHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {compile} from '../scripts/compile-contracts.mjs';
test('timeout permissions, boundary, resubmission, arbitration and payout remain safe',async()=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
 try {
 const client=createPublicClient({transport:custom(rpc)});
 const wallets=Object.values(rpc.getInitialAccounts()).slice(0,5).map(a=>createWalletClient({account:privateKeyToAccount(a.secretKey),transport:custom(rpc)}));
 const [poster,worker,verifier,arbiter,stranger]=wallets;
 const a=compile();
 async function deploy(name,args=[]) {const hash=await poster.deployContract({abi:a[name].abi,bytecode:`0x${a[name].evm.bytecode.object}`,args});return (await client.waitForTransactionReceipt({hash})).contractAddress;}
 const token=await deploy('MockUSDT');
 const address=await deploy('BountyEscrow',[token,verifier.account.address,arbiter.account.address,60]);
 const read=(functionName,args=[])=>client.readContract({address,abi:a.BountyEscrow.abi,functionName,args});
 async function write(wallet,functionName,args=[],target=address,abi=a.BountyEscrow.abi){const {request}=await client.simulateContract({address:target,abi,functionName,args,account:wallet.account});const hash=await wallet.writeContract(request);assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');}
 await write(poster,'mint',[poster.account.address,1000_000000n],token,a.MockUSDT.abi);
 await write(poster,'approve',[address,1000_000000n],token,a.MockUSDT.abi);
 const hash=keccak256(stringToHex('submission'));
 async function task(){const id=await read('bountyCount');const block=await client.getBlock({blockTag:'latest'});await write(poster,'createBounty',[100_000000n,'test',block.timestamp+10000n]);await write(worker,'accept',[id]);await write(worker,'submit',[id,'http://localhost/submission',hash]);return id;}
 const advance=async n=>{await rpc.request({method:'evm_increaseTime',params:[n]});await rpc.request({method:'evm_mine',params:[]});};
 let id=await task();
 await assert.rejects(write(stranger,'escalateVerificationTimeout',[id]));
 await assert.rejects(write(worker,'escalateVerificationTimeout',[id]));
 await advance(599);await assert.rejects(write(poster,'escalateVerificationTimeout',[id]));
 await advance(1);await write(worker,'escalateVerificationTimeout',[id]);assert.equal((await read('getBounty',[id])).status,4);
 await assert.rejects(write(verifier,'verify',[id,true,hash]));await assert.rejects(write(stranger,'resolve',[id,true]));
 await write(arbiter,'resolve',[id,true]);await assert.rejects(write(worker,'claim',[id]));
 id=await task();await advance(600);await write(poster,'escalateVerificationTimeout',[id]);await write(arbiter,'resolve',[id,false]);
 id=await task();const first=await read('submittedAt',[id]);await advance(300);await write(verifier,'verify',[id,false,hash]);await write(worker,'submit',[id,'http://localhost/new',hash]);assert.ok(await read('submittedAt',[id])>first);await advance(300);await assert.rejects(write(worker,'escalateVerificationTimeout',[id]));
 await write(verifier,'verify',[id,true,hash]);await advance(60);await write(stranger,'claim',[id]);await assert.rejects(write(poster,'escalateVerificationTimeout',[id]));
 // Poster-only immediate settlement must bypass the window without bypassing review.
 id=await task();
 await assert.rejects(write(poster,'confirmAndPay',[id]));
 await write(verifier,'verify',[id,true,hash]);
 await assert.rejects(write(worker,'confirmAndPay',[id]));
 await assert.rejects(write(stranger,'confirmAndPay',[id]));
 await assert.rejects(write(verifier,'confirmAndPay',[id]));
 await assert.rejects(write(stranger,'claim',[id]));
 const balance=()=>client.readContract({address:token,abi:a.MockUSDT.abi,functionName:'balanceOf',args:[worker.account.address]});
 const before=await balance();
 await write(poster,'confirmAndPay',[id]);
 assert.equal(await balance(),before+100_000000n);
 assert.equal((await read('getBounty',[id])).status,5);
 await assert.rejects(write(poster,'confirmAndPay',[id]));
 await assert.rejects(write(stranger,'claim',[id]));
 await assert.rejects(write(poster,'dispute',[id]));
 id=await task();await write(verifier,'verify',[id,true,hash]);await write(poster,'dispute',[id]);
 await assert.rejects(write(poster,'confirmAndPay',[id]));
 await write(arbiter,'resolve',[id,false]);
 assert.equal(await client.readContract({address:token,abi:a.MockUSDT.abi,functionName:'balanceOf',args:[address]}),0n);
 }finally{await rpc.disconnect();}
});
