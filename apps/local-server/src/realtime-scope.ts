export type ChangeScope='full'|'menu'|'tables'|'orders'|'sales'|'drafts'|'print';

// Unknown commands remain conservative. This is an invalidation hint, not an
// authorization decision or a source of business data.
export function scopeForCommand(type:string):ChangeScope {
 if(type==='menu.publish'||type==='menu.stoplist'||type==='menu.stoplist.category'||type==='menu.cloud.apply'||type==='menu.cloud.resolve'||type==='sales.catalog.pin')return 'menu';
 if(type==='table.zone.save'||type==='table.config.save'||type==='table.floor_plan.save')return 'tables';
 if(type==='print.operator.action'||type==='print.diagnostic'||type==='print.diagnostic.resolve'||type==='print.device.configure'||type==='print.route.configure')return 'print';
 if(type==='table.visit.open'||type==='table.visit.assign'||type==='table.visit.close_empty'||type==='table.visit.move'||type==='table.visit.responsible'||type==='table.batch.submit'||type==='counter.batch'||type==='order.fulfillment.mark')return 'orders';
 if(type==='order.checkout'||type==='order.settle'||type==='order.correction'||type==='order.discount.set'||type==='counter.hide'||type==='payment.refund'||type==='order.refund')return 'sales';
 return 'full';
}
