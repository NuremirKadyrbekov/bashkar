// Disposable QA process only. Receives fixture credentials through stdin, never logs them.
import Database from 'better-sqlite3';
import {CommandBus} from '../../src/command-bus';
import {AuthService} from '../../src/modules/auth/auth-service';
import {MenuService} from '../../src/modules/menu/menu-service';
import {TableService} from '../../src/modules/tables/table-service';
import {OrderService} from '../../src/modules/orders/order-service';
import {FinanceService} from '../../src/modules/orders/finance-service';
import {ShiftFinanceService} from '../../src/modules/shifts/shift-finance-service';
async function main(){let text='';for await(const part of process.stdin)text+=part;const input=JSON.parse(text),db=new Database(input.path);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=10000');const now=()=>input.now,bus=new CommandBus(db,now),auth=new AuthService(db,bus,input.branchId,now),tables=new TableService(db,bus,auth,now),orders=new OrderService(db,bus,auth,new MenuService(db,bus,auth,now),tables,now),finance=new FinanceService(orders),service=new ShiftFinanceService(finance);
try{let result;if(input.action==='close')result=await service.close(input.token,input.commandId,input.payload,input.login,input.password);else if(input.action==='refund')result=await service.refund(input.token,input.paymentId,input.payload,input.commandId);else result=await finance.counterCommit(input.token,null,input.payload,input.commandId);process.stdout.write(JSON.stringify({ok:true,result}));}catch(error){process.stdout.write(JSON.stringify({ok:false,code:(error as Error).message}));}finally{db.close();}

}
void main().catch(()=>{process.exitCode=1;});
