import {describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {run} from '../../scripts/5d3b4a-probe'
const read=(p:string)=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'))
const input={rfc:read('crates/nomina-fiscal-package/tests/vectors/rfc8032-public.json'),wycheproof:read('crates/nomina-fiscal-package/tests/vectors/wycheproof-ed25519.json'),jcs:read('crates/nomina-fiscal-package/tests/vectors/jcs.json'),parity:read('docs/evidence/5d3b3/parity-v3.json'),fixtures:read('docs/evidence/5d3b3/fixtures-v3.json'),maximum:read('docs/evidence/5d3b3/maximum-v3.json'),plus:read('docs/evidence/5d3b3/maximum-v3-plus1.json')}
const before=read('docs/evidence/5d3b4a/crypto-before.json'),result=run(input)
describe('5D.3b.4-A Noble2.4: oráculos públicos y decisiones anteriores inmutables',()=>{
 it.each(Object.keys(result.groups))('%s: resultados públicos y perfil estricto',group=>{expect(result.checks.filter(c=>c.group===group&&!c.passed)).toEqual([])})
 it('mantiene todas las decisiones semánticas capturadas antes de migrar',()=>{expect(result).toEqual(before.result);expect(result.status).toBe('passed')})
})
