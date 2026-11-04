// Test-only independent writer for the shared TABLE/COUNTER number sequence.
import Database from 'better-sqlite3';
import {CommandBus} from '../../src/command-bus';
import {AuthService} from '../../src/modules/auth/auth-service';
import {MenuService} from '../../src/modules/menu/menu-service';
import {TableService} from '../../src/modules/tables/table-service';
import {OrderService} from '../../src/modules/orders/order-service';
import {FinanceService} from '../../src/modules/orders/finance-service';
(async()=>{let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw),db=new Database(input.path);try{db.pragma('foreign_keys=ON');db.pragma('busy_timeout=5000');const bus=new CommandBus(db),auth=new AuthService(db,bus,input.branchId),menu=new MenuService(db,bus,auth),tables=new TableService(db,bus,auth),orders=new OrderService(db,bus,auth,menu,tables),finance=new FinanceService(orders);const result=input.type==='TABLE'?await orders.submit(input.token,input.commandId,input.sessionId,input.payload):await finance.counterCommit(input.token,null,input.payload,input.commandId);process.stdout.write(JSON.stringify(result));}finally{db.close();}})().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});
