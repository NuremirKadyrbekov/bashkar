import type Database from 'better-sqlite3';
import { integer } from '../../errors';
// Called only inside the order's CommandBus transaction. A failed commit rolls
// back allocation too, and replay returns the original command receipt.
export function nextOrderNumber(db:Database.Database,branchId:string,shiftId:string):number {
 const row=db.prepare('SELECT next_number FROM order_sequences WHERE branch_id=? AND shift_id=?').get(branchId,shiftId) as {next_number:number}|undefined;
 const number=integer(row?.next_number??1,1,Number.MAX_SAFE_INTEGER-1,'ORDER_NUMBER_EXHAUSTED');
 db.prepare('INSERT INTO order_sequences VALUES(?,?,?) ON CONFLICT(branch_id,shift_id) DO UPDATE SET next_number=excluded.next_number').run(branchId,shiftId,number+1);
 return number;
}
export function assignOrderNumber(db:Database.Database,branchId:string,shiftId:string,orderId:string,number:number){
 db.prepare('INSERT INTO order_numbers VALUES(?,?,?,?)').run(branchId,orderId,shiftId,number);
}
export function readOrderNumber(db:Database.Database,branchId:string,orderId:string):number|null {
 return (db.prepare('SELECT number FROM order_numbers WHERE branch_id=? AND order_id=?').get(branchId,orderId) as {number:number}|undefined)?.number??null;
}
