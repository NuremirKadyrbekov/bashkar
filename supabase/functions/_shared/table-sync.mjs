const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===names.slice().sort().join(',');
const label=value=>typeof value==='string'&&value.length>0&&value.length<=200&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const rowRevision=value=>Number.isSafeInteger(value)&&value>=1;
export function validateTableSnapshot(body){
 if(!exact(body,['commandId','revision','hash','document'])||!uuid(body.commandId)||!rowRevision(body.revision)||typeof body.hash!=='string'||!(/^[0-9a-f]{64}$/).test(body.hash)||!exact(body.document,['zones','tables']))throw Error('INVALID_TABLE_SNAPSHOT');
 const {zones,tables}=body.document;
 if(!Array.isArray(zones)||zones.length>100||!Array.isArray(tables)||tables.length>1000)throw Error('INVALID_TABLE_SNAPSHOT');
 const zoneIds=new Set(),tableIds=new Set(),codes=new Set();
 for(const z of zones){if(!exact(z,['id','name','active','revision'])||!uuid(z.id)||zoneIds.has(z.id)||!label(z.name)||typeof z.active!=='boolean'||!rowRevision(z.revision))throw Error('INVALID_TABLE_SNAPSHOT');zoneIds.add(z.id);}
 for(const t of tables){if(!exact(t,['id','zoneId','code','name','active','revision'])||!uuid(t.id)||tableIds.has(t.id)||!zoneIds.has(t.zoneId)||!(/^[A-Za-z0-9_-]{22}$/).test(t.code)||codes.has(t.code)||!label(t.name)||typeof t.active!=='boolean'||!rowRevision(t.revision))throw Error('INVALID_TABLE_SNAPSHOT');tableIds.add(t.id);codes.add(t.code);}
}
