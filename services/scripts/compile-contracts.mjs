import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import solc from 'solc';
const root = fileURLToPath(new URL('../../', import.meta.url));
export function compile() {
  const sources = Object.fromEntries(['BountyEscrow','MockUSDT'].map(name => [`${name}.sol`, { content: fs.readFileSync(path.join(root, 'contracts/src', `${name}.sol`), 'utf8') }]));
  const out = JSON.parse(solc.compile(JSON.stringify({language:'Solidity', sources, settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}), {import: name => {
    const resolved = path.resolve(root, 'services/node_modules', name);
    if (!resolved.startsWith(path.resolve(root, 'services/node_modules/@openzeppelin') + path.sep)) return {error:'Unsupported import'};
    try { return {contents:fs.readFileSync(resolved,'utf8')}; } catch { return {error:`Missing ${name}`}; }
  }}));
  const errors=(out.errors||[]).filter(e=>e.severity==='error');
  if(errors.length) throw Error(errors.map(e=>e.formattedMessage).join('\n'));
  return Object.fromEntries(['BountyEscrow','MockUSDT'].map(name=>[name,out.contracts[`${name}.sol`][name]]));
}
if(process.argv.includes('--write-abi')) {
  for(const [name, contract] of Object.entries(compile())) for(const dir of ['shared','web/abi']) fs.writeFileSync(path.join(root,dir,`${name}.abi.json`),JSON.stringify(contract.abi,null,2)+'\n');
  console.log('Compiled Solidity 0.8.24; shared and web ABIs synchronized.');
}
